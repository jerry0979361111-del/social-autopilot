import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { askJson, generatePhoto, uploadImage } from "./ai";
import { brand } from "./config";
import type { PhotoInfo } from "./types";

// 貼文配圖：先依「已定稿的文案」做美術企劃，再找真實照片（圖庫），最後套上品牌版型（標題、品牌列、Logo）。
// 版型參考房地產社群常見做法：大面積建案或在地實景照片 ＋ 底部漸層上的中文標題 ＋ 固定的品牌識別。

const W = 1080;
const H = 1350; // IG 直式 4:5

export type ArtDirection = {
  /** 圖上主標，12～16 字 */
  headline: string;
  /** 圖上副標，24 字內 */
  subline: string;
  /** 左上角小標籤，例如「墨爾本・學區」 */
  tag: string;
  /** 給產圖模型的英文畫面描述（找不到真實照片、且允許 AI 產圖時才用） */
  scene: string;
  /** 找真實照片用的英文關鍵字，由具體到一般 */
  queries: string[];
};

export async function artDirect(caption: string, topic: string): Promise<ArtDirection> {
  const instructions = [
    `你是「${brand.name}」的社群美術總監，品牌經營澳洲（以墨爾本為主）房產，主要受眾是留學生家長。`,
    "請讀完已定稿的貼文文案，為它規劃一張社群主視覺。",
    "參考澳洲與台灣房地產社群的常見風格：畫面以「當地建案或風景實景」為主角，例如：",
    "- 建築外觀：墨爾本 CBD 或內城區的現代公寓大樓、低密度精品公寓、Townhouse、維多利亞式排屋立面",
    "- 室內：採光好的客廳與開放式廚房、有書桌的臥室、看得到城市景觀的陽台",
    "- 區域與街景：綠樹成蔭的住宅街道、Carlton／Parkville／Box Hill／Clayton 等大學周邊街區、電車經過的大街",
    "- 城市與自然：Yarra River 與 Southbank 天際線、黃昏或藍調時刻的 CBD、公園綠地、空拍的住宅區",
    "- 大學：校園建築外觀（例如墨爾本大學的砂岩建築）作為區位意象",
    "畫面要和文案的主題直接相關（談學區就拍大學周邊街區，談買房就拍建案外觀或室內，談生活就拍街景或城市風景）。",
    "人物最多只能是遠景中的小人，不要人物特寫、不要人臉。",
    "headline：圖上主標，8～14 個字（越短越好），抓住文案重點、讓家長想停下來看；可用一個逗號分成兩段，不要堆疊符號。",
    "subline：圖上副標，24 字內，補充一句具體資訊或好處。",
    "tag：左上角標籤，格式像「墨爾本・學區」「買房知識」「留學生活」，8 字內。",
    "queries：3～4 組到圖庫找「真實照片」用的英文關鍵字，由具體到一般，每組 2～5 個英文單字，例如 [\"Carlton Melbourne terrace houses\", \"Melbourne university campus\", \"Melbourne suburb street\", \"Melbourne skyline\"]。",
    "scene：英文 50～100 字，具體寫出地點、建築或景物、季節、時間與光線、拍攝角度；不要描述任何文字或招牌。",
    "headline、subline 不得出現保證獲利、誇大或捏造的數字。",
    '只輸出 JSON：{"headline":"...","subline":"...","tag":"...","queries":["..."],"scene":"..."}',
  ].join("\n");
  const r = await askJson<ArtDirection>(instructions, `主題：${topic}\n\n文案：\n${caption}`);
  return {
    headline: String(r.headline ?? "").slice(0, 22),
    subline: String(r.subline ?? "").slice(0, 32),
    tag: String(r.tag ?? "").slice(0, 10),
    scene: String(r.scene ?? topic),
    queries: Array.isArray(r.queries) ? r.queries.map(String).filter(Boolean).slice(0, 4) : [],
  };
}

// ---------- 真實照片來源 ----------

type Found = { bytes: Buffer; info: PhotoInfo };
// 圖庫 API 要求帶上可辨識的 User-Agent
const UA = "social-autopilot/1.0 (+https://github.com/jerry0979361111-del/social-autopilot)";

async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, cache: "no-store" });
  if (!res.ok) throw new Error(`下載照片失敗 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Pexels：真實攝影、可免費商用，不需標示作者。需要 PEXELS_API_KEY。 */
async function fromPexels(query: string, avoid: Set<string>): Promise<Found | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({ query, orientation: "portrait", size: "large", per_page: "20" });
  const res = await fetch(`https://api.pexels.com/v1/search?${q}`, { headers: { Authorization: key }, cache: "no-store" });
  if (!res.ok) return null;
  const photos: any[] = (await res.json()).photos ?? [];
  const pick = photos.filter((p) => !avoid.has(`pexels:${p.id}`)).slice(0, 6);
  if (pick.length === 0) return null;
  const p = pick[Math.floor(Math.random() * pick.length)];
  return {
    bytes: await download(p.src.large2x ?? p.src.original),
    info: { source: "pexels", id: `pexels:${p.id}`, credit: `Photo: ${p.photographer} / Pexels`, pageUrl: p.url },
  };
}

const FREE_LICENSE = /^(cc0|cc by(-sa)? \d|cc by(-sa)?$|public domain|pd)/i;
const BAD_TITLE = /map|logo|diagram|plan|chart|seal|flag|poster|sign|svg|drawing|painting/i;
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Wikimedia Commons：真實照片、免註冊；CC 授權需標示作者與授權。 */
async function fromWikimedia(query: string, avoid: Set<string>): Promise<Found | null> {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1600",
    origin: "*",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const pages: any[] = Object.values((await res.json()).query?.pages ?? {});
  const ok = pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ p, ii }) => {
      if (!ii || ii.mime !== "image/jpeg" || ii.width < 1600 || ii.height < 1000) return false;
      if (BAD_TITLE.test(p.title) || avoid.has(`wikimedia:${p.pageid}`)) return false;
      const lic = stripHtml(ii.extmetadata?.LicenseShortName?.value ?? "");
      return FREE_LICENSE.test(lic);
    })
    .slice(0, 6);
  if (ok.length === 0) return null;
  const { p, ii } = ok[Math.floor(Math.random() * ok.length)];
  const artist = stripHtml(ii.extmetadata?.Artist?.value ?? "").slice(0, 40) || "Unknown";
  const lic = stripHtml(ii.extmetadata?.LicenseShortName?.value ?? "");
  return {
    bytes: await download(ii.thumburl ?? ii.url),
    info: {
      source: "wikimedia",
      id: `wikimedia:${p.pageid}`,
      credit: `Photo: ${artist} / Wikimedia Commons, ${lic}`,
      pageUrl: ii.descriptionurl,
    },
  };
}

/** 依關鍵字由具體到一般找真實照片；都找不到時，才視設定改用 AI 產圖。 */
async function findPhoto(art: ArtDirection, avoid: Set<string>): Promise<Found> {
  const queries = [...art.queries, "Melbourne suburb street", "Melbourne skyline"];
  for (const q of queries) {
    for (const source of [fromPexels, fromWikimedia]) {
      try {
        const found = await source(q, avoid);
        if (found) return found;
      } catch {
        // 換下一個來源或關鍵字
      }
    }
  }
  if (process.env.ALLOW_AI_PHOTOS === "1") return { bytes: await generatePhoto(art.scene), info: { source: "ai" } };
  throw new Error("找不到合適的真實照片（可在 Vercel 設定 PEXELS_API_KEY 擴大圖庫，或上傳自己的照片）");
}

let assets: Promise<{ serif: Buffer; sans: Buffer; logo: string }> | null = null;
function loadAssets() {
  assets ??= (async () => {
    const dir = path.join(process.cwd(), "assets");
    const [serif, sans, logo] = await Promise.all([
      readFile(path.join(dir, "fonts", "NotoSerifTC_700Bold.ttf")),
      readFile(path.join(dir, "fonts", "NotoSansTC_500Medium.ttf")),
      readFile(path.join(dir, "logo-white.png")),
    ]);
    return { serif, sans, logo: `data:image/png;base64,${logo.toString("base64")}` };
  })();
  return assets;
}

/** 把照片排進品牌版型，回傳 JPEG。 */
export async function composePost(
  photo: Buffer,
  art: Pick<ArtDirection, "headline" | "subline" | "tag">,
  credit?: string,
): Promise<Buffer> {
  const { serif, sans, logo } = await loadAssets();
  const bg = await sharp(photo).resize(W, H, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
  const bgUri = `data:image/jpeg;base64,${bg.toString("base64")}`;
  const hex = /^#?([0-9a-f]{6})$/i.exec(brand.colorPrimary)?.[1] ?? "2E5E8C";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const gold = "#D9A94E";
  const champagne = "#F3E6C4";
  // 依字數縮放，讓主標盡量排成一到兩行整齊的字
  const len = [...art.headline].length;
  const headlineSize = len <= 9 ? 80 : len <= 12 ? 72 : len <= 14 ? 64 : 56;

  const res = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Sans" }}>
        <img src={bgUri} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 640,
            display: "flex",
            backgroundImage: `linear-gradient(180deg, rgba(20,40,64,0) 0%, rgba(20,40,64,0.55) 35%, rgba(${r},${g},${b},0.95) 100%)`,
          }}
        />
        {art.tag && (
          <div
            style={{
              position: "absolute",
              top: 56,
              left: 64,
              display: "flex",
              padding: "10px 22px",
              border: `2px solid ${gold}`,
              backgroundColor: "rgba(20,40,64,0.55)",
              color: "#ffffff",
              fontSize: 28,
              letterSpacing: 2,
            }}
          >
            {art.tag}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 170,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ width: 88, height: 4, backgroundColor: gold, marginBottom: 28, display: "flex" }} />
          <div
            style={{
              fontFamily: "Serif",
              fontSize: headlineSize,
              lineHeight: 1.25,
              color: "#ffffff",
              display: "flex",
              textShadow: "0 2px 12px rgba(0,0,0,0.25)",
            }}
          >
            {art.headline}
          </div>
          {art.subline && (
            <div style={{ fontSize: 34, lineHeight: 1.5, color: champagne, marginTop: 20, display: "flex" }}>
              {art.subline}
            </div>
          )}
        </div>
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 56,
            height: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(243,230,196,0.45)",
            paddingTop: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={logo} width={60} height={51} style={{ marginRight: 18 }} />
            <div style={{ fontFamily: "Serif", fontSize: 30, color: "#ffffff", display: "flex" }}>{brand.name}</div>
          </div>
          <div style={{ fontFamily: "Serif", fontSize: 26, color: gold, letterSpacing: 4, display: "flex" }}>
            {brand.slogan}
          </div>
        </div>
        {credit && (
          <div
            style={{
              position: "absolute",
              right: 24,
              top: 24,
              display: "flex",
              fontSize: 16,
              color: "rgba(255,255,255,0.8)",
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}
          >
            {credit.replace(/[^\x20-\x7E]/g, "")}
          </div>
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Serif", data: serif, weight: 700, style: "normal" },
        { name: "Sans", data: sans, weight: 500, style: "normal" },
      ],
    },
  );
  const png = Buffer.from(await res.arrayBuffer());
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/**
 * 文案定稿後產生貼文主視覺：美術企劃 → 真實照片（使用者上傳的照片優先）→ 品牌版型 → 上傳。
 */
export async function designPostImage(input: {
  caption: string;
  topic: string;
  photo?: Buffer;
  avoidPhotoIds?: string[];
}): Promise<{ url: string; photo: PhotoInfo }> {
  const art = await artDirect(input.caption, input.topic);
  const found: Found = input.photo
    ? { bytes: input.photo, info: { source: "upload" } }
    : await findPhoto(art, new Set(input.avoidPhotoIds ?? []));
  // Wikimedia 的 CC 授權要求在圖上標示作者與授權
  const jpeg = await composePost(found.bytes, art, found.info.source === "wikimedia" ? found.info.credit : undefined);
  return { url: await uploadImage(jpeg, "image/jpeg"), photo: found.info };
}
