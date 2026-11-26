import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { askJson, generatePhoto, uploadImage } from "./ai";
import { brand } from "./config";
import { listLibrary } from "./library";
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
  /** 從照片庫選中的照片 */
  libraryId?: string;
  /** 輪播內頁（每張一個重點） */
  slides?: { title: string; body: string }[];
  /** 輪播最後一張：互動問題與 CTA */
  question?: string;
  cta?: string;
};

export type LibraryChoice = { id: string; label: string };

export async function artDirect(
  caption: string,
  topic: string,
  opts: { library?: LibraryChoice[]; carousel?: boolean } = {},
): Promise<ArtDirection> {
  const library = opts.library ?? [];
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
    "headline、subline 不得出現保證獲利、誇大或捏造的數字，也不可比文案更正面或更樂觀；文案若在講限制變嚴、成本增加，標題就要如實反映。",
    library.length
      ? [
          "以下是品牌自己的照片庫（官網建案圖與實拍素材），請優先使用：",
          "如果文案提到某個建案、區域或城市，或主題適合用建案外觀、室內來表現，就從清單挑最貼切的一張，把它的 id 填進 libraryId；",
          "清單裡沒有合適的（例如主題在講布里斯本卻只有墨爾本的照片），libraryId 填 null，改用 queries 去公開圖庫找。",
          library.map((x) => `${x.id}｜${x.label}`).join("\n"),
        ].join("\n")
      : "",
    opts.carousel
      ? [
          "這篇是 IG 輪播貼文，請另外規劃內頁：",
          "slides：4～6 張，每張只講一個重點。title 14 字內，要具體寫出這張的重點（例如「境內不能再轉簽學生簽證」），不可用「重點一」「主要新規」這類空泛標題。",
          "body：3～4 個列點，每點一行、以「・」開頭、12～20 字（要能在圖上排成一行），寫出具體資訊（對象、條件、日期、數字、該怎麼做）；資訊來自文案，不可新增文案沒有的事實。",
          "第一張內頁說明「為什麼這件事跟你有關」，最後一張內頁整理家長或買家該做的準備與注意事項。",
          "question：最後一張的互動問題，只問一個、容易回答（例如「你會選 A 還是 B？」），30 字內。",
          "cta：最後一張的行動呼籲，30 字內（例如「收藏起來，分享給正在準備留學的家長」或「私訊『墨爾本』索取選區整理」）。",
        ].join("\n")
      : "",
    `只輸出 JSON：{"headline":"...","subline":"...","tag":"...","libraryId":null,"queries":["..."],"scene":"..."${opts.carousel ? ',"slides":[{"title":"...","body":"..."}],"question":"...","cta":"..."' : ""}}`,
  ]
    .filter(Boolean)
    .join("\n");
  const r = await askJson<ArtDirection>(instructions, `主題：${topic}\n\n文案：\n${caption}`);
  return {
    headline: String(r.headline ?? "").slice(0, 22),
    subline: String(r.subline ?? "").slice(0, 32),
    tag: String(r.tag ?? "").slice(0, 10),
    scene: String(r.scene ?? topic),
    queries: Array.isArray(r.queries) ? r.queries.map(String).filter(Boolean).slice(0, 4) : [],
    libraryId: r.libraryId && library.some((x) => x.id === r.libraryId) ? String(r.libraryId) : undefined,
    slides: Array.isArray(r.slides)
      ? r.slides
          .map((x: any) => ({ title: String(x?.title ?? "").slice(0, 20), body: String(x?.body ?? "").slice(0, 220) }))
          .filter((x) => x.title)
          .slice(0, 6)
      : undefined,
    question: r.question ? String(r.question).slice(0, 40) : undefined,
    cta: r.cta ? String(r.cta).slice(0, 40) : undefined,
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

let assets: Promise<{ serif: Buffer; sans: Buffer }> | null = null;
function loadAssets() {
  assets ??= (async () => {
    const dir = path.join(process.cwd(), "assets", "fonts");
    const [serif, sans] = await Promise.all([
      readFile(path.join(dir, "NotoSerifTC_700Bold.ttf")),
      readFile(path.join(dir, "NotoSansTC_500Medium.ttf")),
    ]);
    return { serif, sans };
  })();
  return assets;
}

const FONTS = (serif: Buffer, sans: Buffer) => [
  { name: "Serif", data: serif, weight: 700 as const, style: "normal" as const },
  { name: "Sans", data: sans, weight: 500 as const, style: "normal" as const },
];

const GOLD = "#D9A94E";
const CHAMPAGNE = "#F3E6C4";
const IVORY = "#FBF8F2";
const INK = "#26313F";

function brandRgb() {
  const hex = /^#?([0-9a-f]{6})$/i.exec(brand.colorPrimary)?.[1] ?? "2E5E8C";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** 底部品牌列：只用文字品牌名（不放 Logo 圖檔）與標語 */
function BrandBar({ color = "#ffffff", line = "rgba(243,230,196,0.45)" }: { color?: string; line?: string }) {
  return (
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
        borderTop: `1px solid ${line}`,
        paddingTop: 20,
      }}
    >
      <div style={{ fontFamily: "Serif", fontSize: 34, color, letterSpacing: 6, display: "flex" }}>{brand.name}</div>
      <div style={{ fontFamily: "Serif", fontSize: 26, color: GOLD, letterSpacing: 4, display: "flex" }}>{brand.slogan}</div>
    </div>
  );
}

async function render(node: React.ReactElement): Promise<Buffer> {
  const { serif, sans } = await loadAssets();
  const res = new ImageResponse(node, { width: W, height: H, fonts: FONTS(serif, sans) });
  return sharp(Buffer.from(await res.arrayBuffer())).jpeg({ quality: 88 }).toBuffer();
}

/** 封面：照片＋標題，排進品牌版型，回傳 JPEG。 */
export async function composePost(
  photo: Buffer,
  art: Pick<ArtDirection, "headline" | "subline" | "tag">,
  credit?: string,
): Promise<Buffer> {
  const bg = await sharp(photo).resize(W, H, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
  const bgUri = `data:image/jpeg;base64,${bg.toString("base64")}`;
  const [r, g, b] = brandRgb();
  // 依字數縮放，讓主標盡量排成一到兩行整齊的字
  const len = [...art.headline].length;
  const headlineSize = len <= 9 ? 80 : len <= 12 ? 72 : len <= 14 ? 64 : 56;

  return render(
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
            border: `2px solid ${GOLD}`,
            backgroundColor: "rgba(20,40,64,0.55)",
            color: "#ffffff",
            fontSize: 28,
            letterSpacing: 2,
          }}
        >
          {art.tag}
        </div>
      )}
      <div style={{ position: "absolute", left: 64, right: 64, bottom: 170, display: "flex", flexDirection: "column" }}>
        <div style={{ width: 88, height: 4, backgroundColor: GOLD, marginBottom: 28, display: "flex" }} />
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
          <div style={{ fontSize: 34, lineHeight: 1.5, color: CHAMPAGNE, marginTop: 20, display: "flex" }}>{art.subline}</div>
        )}
      </div>
      <BrandBar />
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
    </div>,
  );
}

/** 輪播內頁：象牙底、編號、標題與重點，像雜誌內頁。 */
export async function composeSlide(index: number, total: number, slide: { title: string; body: string }): Promise<Buffer> {
  const [r, g, b] = brandRgb();
  const blue = `rgb(${r},${g},${b})`;
  const lines = slide.body
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  // 依最長一行縮放字級，盡量讓每個列點排在一行內，避免單字落到下一行
  const longest = Math.max(0, ...lines.map((l) => [...l.replace(/^[・•\-]\s*/, "")].length));
  const bodySize = longest <= 19 ? 42 : longest <= 21 ? 38 : longest <= 23 ? 35 : 34;
  return render(
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", position: "relative", backgroundColor: IVORY, fontFamily: "Sans" }}>
      <div style={{ height: 16, backgroundColor: blue, display: "flex" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "0 88px 150px 88px" }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <div style={{ fontFamily: "Serif", fontSize: 120, color: GOLD, lineHeight: 1, display: "flex" }}>
            {String(index).padStart(2, "0")}
          </div>
          <div style={{ fontSize: 30, color: "#8C6A2E", marginLeft: 20, display: "flex" }}>/ {String(total).padStart(2, "0")}</div>
        </div>
        <div style={{ width: 88, height: 4, backgroundColor: GOLD, margin: "40px 0 36px 0", display: "flex" }} />
        <div style={{ fontFamily: "Serif", fontSize: 64, lineHeight: 1.3, color: blue, display: "flex" }}>{slide.title}</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 48 }}>
          {lines.map((line, i) => {
            const bullet = /^[・•\-]\s*/.exec(line);
            return (
              <div key={i} style={{ fontSize: bodySize, lineHeight: 1.6, color: INK, display: "flex", marginBottom: 22 }}>
                {bullet && <div style={{ color: GOLD, width: 44, flexShrink: 0, display: "flex" }}>・</div>}
                <div style={{ display: "flex", flex: 1 }}>{bullet ? line.slice(bullet[0].length) : line}</div>
              </div>
            );
          })}
        </div>
      </div>
      <BrandBar color={blue} line="rgba(46,94,140,0.25)" />
    </div>,
  );
}

/** 輪播最後一張：互動問題＋CTA，品牌藍底。 */
export async function composeEnd(question: string, cta: string): Promise<Buffer> {
  const [r, g, b] = brandRgb();
  return render(
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        backgroundColor: `rgb(${r},${g},${b})`,
        padding: "0 88px",
        fontFamily: "Sans",
      }}
    >
      <div style={{ fontSize: 34, color: GOLD, letterSpacing: 4, display: "flex", marginBottom: 28 }}>想聽聽你的看法</div>
      <div style={{ fontFamily: "Serif", fontSize: 64, lineHeight: 1.35, color: "#ffffff", display: "flex" }}>{question}</div>
      <div style={{ width: 88, height: 4, backgroundColor: GOLD, margin: "56px 0 40px 0", display: "flex" }} />
      <div style={{ fontSize: 40, lineHeight: 1.6, color: CHAMPAGNE, display: "flex" }}>{cta}</div>
      <BrandBar />
    </div>,
  );
}

export type DesignResult = { url: string; urls?: string[]; photo: PhotoInfo };

/**
 * 文案定稿後產生貼文圖片：美術企劃 → 照片（上傳的照片 > 照片庫 > 公開圖庫）→ 品牌版型 → 上傳。
 * carousel 時另外產生內頁與結尾頁（IG 輪播）。
 */
export async function designPostImage(input: {
  caption: string;
  topic: string;
  photo?: Buffer;
  avoidPhotoIds?: string[];
  carousel?: boolean;
}): Promise<DesignResult> {
  const avoid = new Set(input.avoidPhotoIds ?? []);
  const library = input.photo ? [] : (await listLibrary().catch(() => [])).filter((p) => !avoid.has(`library:${p.id}`));
  const art = await artDirect(input.caption, input.topic, {
    carousel: input.carousel,
    library: library.map((p) => ({ id: p.id, label: `${p.data.title}｜${p.data.description}`.slice(0, 160) })),
  });

  let found: Found;
  const picked = library.find((p) => p.id === art.libraryId);
  if (input.photo) found = { bytes: input.photo, info: { source: "upload" } };
  else if (picked) {
    try {
      found = { bytes: await download(picked.data.url), info: { source: "library", id: `library:${picked.id}`, credit: picked.data.title } };
    } catch {
      found = await findPhoto(art, avoid);
    }
  } else found = await findPhoto(art, avoid);

  // Wikimedia 的 CC 授權要求在圖上標示作者與授權
  const cover = await composePost(found.bytes, art, found.info.source === "wikimedia" ? found.info.credit : undefined);
  const coverUrl = await uploadImage(cover, "image/jpeg");
  if (!input.carousel || !art.slides?.length) return { url: coverUrl, photo: found.info };

  const total = art.slides.length;
  const urls = [coverUrl];
  for (const [i, slide] of art.slides.entries()) {
    urls.push(await uploadImage(await composeSlide(i + 1, total, slide), "image/jpeg"));
  }
  if (art.question || art.cta) {
    urls.push(await uploadImage(await composeEnd(art.question ?? "", art.cta ?? ""), "image/jpeg"));
  }
  return { url: coverUrl, urls, photo: found.info };
}
