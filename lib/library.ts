import sharp from "sharp";
import { uploadImage } from "./ai";
import { archiveRecord, createRecord, LIBRARY_PREFIX, queryRecords, type NotionRecord } from "./notion";

// 照片庫：澳洲美家自己的真實照片（官網建案圖、Google 雲端素材、手動上傳）。
// 做圖時優先從這裡挑，找不到合適的才去公開圖庫。

export type LibraryPhoto = {
  kind: "photo";
  /** 可直接下載的圖片網址 */
  url: string;
  title: string;
  description: string;
  city?: string;
  suburb?: string;
  source: "官網" | "雲端" | "上傳";
  /** 來源的唯一識別，避免重複匯入 */
  sourceKey: string;
};

const SITE = "https://mejia.au";
const SITE_DATA =
  "https://raw.githubusercontent.com/jerry0979361111-del/mejia-website/main/src/data/projects.generated.json";
const CITY: Record<string, string> = { melbourne: "墨爾本", sydney: "雪梨", brisbane: "布里斯本", goldcoast: "黃金海岸" };
const TYPE: Record<string, string> = { apt: "公寓", house: "獨立屋", townhouse: "連棟別墅", land: "土地" };

export async function listLibrary(): Promise<NotionRecord<LibraryPhoto>[]> {
  const rows = await queryRecords<LibraryPhoto>(
    { property: "標題", title: { starts_with: LIBRARY_PREFIX } },
    [{ timestamp: "created_time", direction: "descending" }],
    300,
  );
  return rows.filter((r) => r.data?.kind === "photo");
}

async function addPhotos(items: LibraryPhoto[]): Promise<number> {
  const existing = new Set((await listLibrary()).map((r) => r.data.sourceKey));
  let added = 0;
  for (const p of items) {
    if (existing.has(p.sourceKey)) continue;
    await createRecord<LibraryPhoto>({ title: `${LIBRARY_PREFIX}${p.title}`.slice(0, 200), status: "草稿", data: p });
    existing.add(p.sourceKey);
    added++;
  }
  return added;
}

/** 從澳洲美家官網（mejia.au）匯入所有建案主圖，連同建案名稱、城市、區域與簡介。 */
export async function importFromWebsite(): Promise<string> {
  const res = await fetch(SITE_DATA, { cache: "no-store" });
  if (!res.ok) throw new Error(`讀取官網建案資料失敗 ${res.status}`);
  const projects: any[] = await res.json();
  const items: LibraryPhoto[] = [];
  for (const p of projects) {
    const imgs = [p.image, ...(Array.isArray(p.gallery) ? p.gallery : [])].filter(Boolean) as string[];
    imgs.forEach((img, i) => {
      items.push({
        kind: "photo",
        url: img.startsWith("http") ? img : `${SITE}${img}`,
        title: `${p.name}${i ? ` (${i + 1})` : ""}`,
        description: [
          `${CITY[p.city] ?? p.city} ${p.suburb ?? ""} 的${TYPE[p.type] ?? "建案"}「${p.name}」`,
          p.use ? `（${p.use}）` : "",
          p.desc ? `：${p.desc}` : "",
        ].join(""),
        city: CITY[p.city] ?? p.city,
        suburb: p.suburb,
        source: "官網",
        sourceKey: `site:${img}`,
      });
    });
  }
  const added = await addPhotos(items);
  return `官網共 ${items.length} 張建案圖，新增 ${added} 張到照片庫`;
}

function driveId(link: string): string | null {
  return /\/d\/([\w-]{20,})/.exec(link)?.[1] ?? /[?&]id=([\w-]{20,})/.exec(link)?.[1] ?? (/^[\w-]{20,}$/.test(link) ? link : null);
}

/** 下載圖片、縮到最長邊 2048 的 JPEG 後存到 Blob（雲端硬碟原圖常有幾十 MB）。 */
async function storeResized(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`下載失敗 ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error("下載到的是網頁而不是圖片（請確認雲端檔案已設為「知道連結的任何人都能查看」）");
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return uploadImage(jpeg, "image/jpeg");
}

/**
 * 匯入 Google 雲端硬碟的照片。每行一筆：「連結｜說明」，說明可省略。
 * 檔案需設為「知道連結的任何人都能查看」。
 */
export async function importFromDrive(lines: string): Promise<string> {
  const rows = lines
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [link, ...rest] = l.split(/[｜|]/);
      return { id: driveId(link.trim()), note: rest.join(" ").trim() };
    });
  const bad = rows.filter((r) => !r.id).length;
  const existing = new Set((await listLibrary()).map((r) => r.data.sourceKey));
  const items: LibraryPhoto[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    if (!r.id || existing.has(`drive:${r.id}`)) continue;
    try {
      const url = await storeResized(`https://drive.usercontent.google.com/download?id=${r.id}&export=download&confirm=t`);
      items.push({
        kind: "photo",
        url,
        title: r.note || `雲端照片 ${r.id.slice(0, 6)}`,
        description: r.note || "Google 雲端硬碟素材",
        source: "雲端",
        sourceKey: `drive:${r.id}`,
      });
    } catch (e: any) {
      failed.push(`${r.id.slice(0, 8)}…：${e?.message ?? e}`);
    }
  }
  const added = await addPhotos(items);
  return [
    `新增 ${added} 張`,
    bad ? `${bad} 行看不出是雲端連結` : "",
    failed.length ? `失敗 ${failed.length} 張：${failed.slice(0, 3).join("；")}` : "",
  ]
    .filter(Boolean)
    .join("，");
}

/** 手動上傳：存到 Blob 後加進照片庫 */
export async function addUpload(file: Buffer, title: string, description: string): Promise<void> {
  const jpeg = await sharp(file).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const url = await uploadImage(jpeg, "image/jpeg");
  await addPhotos([{ kind: "photo", url, title, description: description || title, source: "上傳", sourceKey: `upload:${url}` }]);
}

export async function removePhoto(id: string): Promise<void> {
  await archiveRecord(id);
}
