import { env } from "./config";
import { getConnection, selectedPage } from "./meta";
import { STATUSES } from "./notion";

export type Check = { name: string; ok: boolean; detail: string };

const REQUIRED_ENV = [
  "NEXT_PUBLIC_BASE_URL",
  "NOTION_API_KEY",
  "NOTION_POSTS_DB_ID",
  "OPENAI_API_KEY",
  "META_APP_ID",
  "META_APP_SECRET",
  "CRON_SECRET",
];
const BRAND_ENV = ["BRAND_NAME", "BRAND_COLOR_PRIMARY", "BRAND_COLOR_SECONDARY", "BRAND_STYLE", "BRAND_TONE"];

async function checkNotionSchema(): Promise<Check> {
  const name = "Notion 資料庫欄位";
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${env.notionDb()}`, {
      headers: { Authorization: `Bearer ${env.notionKey()}`, "Notion-Version": "2022-06-28" },
      cache: "no-store",
    });
    const db = await res.json();
    if (!res.ok)
      return {
        name,
        ok: false,
        detail: `${res.status} ${db.message ?? ""}${res.status === 404 ? "（資料庫頁面右上角 ⋯ → 連接 → 選你的整合）" : ""}`,
      };
    const p = db.properties ?? {};
    const problems: string[] = [];
    const expect: Record<string, string> = { 標題: "title", 狀態: "select", 發布時間: "date", 資料JSON: "rich_text" };
    for (const [k, type] of Object.entries(expect)) {
      if (!p[k]) problems.push(`缺少欄位「${k}」`);
      else if (p[k].type !== type) problems.push(`「${k}」類型應為 ${type}，目前是 ${p[k].type}`);
    }
    const options: string[] = (p["狀態"]?.select?.options ?? []).map((o: any) => o.name);
    const missing = STATUSES.filter((s) => !options.includes(s));
    if (p["狀態"]?.type === "select" && missing.length) problems.push(`「狀態」缺少選項：${missing.join("、")}`);
    return problems.length ? { name, ok: false, detail: problems.join("；") } : { name, ok: true, detail: "四個欄位與五個狀態都正確" };
  } catch (e: any) {
    return { name, ok: false, detail: String(e?.message ?? e) };
  }
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  checks.push({
    name: "必填環境變數",
    ok: missing.length === 0,
    detail: missing.length ? `缺少：${missing.join(", ")}（設定後要 Redeploy）` : "全部已設定",
  });
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  checks.push({
    name: "公開網址",
    ok: /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base),
    detail: base || "未設定",
  });
  checks.push({
    name: "圖片儲存（Vercel Blob）",
    ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    detail: process.env.BLOB_READ_WRITE_TOKEN ? "已連接" : "未連接：Vercel 專案 → Storage → 建立 Blob 並連接此專案，再 Redeploy",
  });
  const brandMissing = BRAND_ENV.filter((k) => !process.env[k]);
  checks.push({
    name: "品牌設定",
    ok: brandMissing.length === 0,
    detail: brandMissing.length ? `使用預設值：${brandMissing.join(", ")}` : "已自訂",
  });
  if (process.env.NOTION_API_KEY && process.env.NOTION_POSTS_DB_ID) {
    checks.push(await checkNotionSchema());
    try {
      const page = selectedPage(await getConnection());
      checks.push({
        name: "Meta 連線",
        ok: Boolean(page),
        detail: page ? `粉專：${page.name}；IG：${page.igUsername ? "@" + page.igUsername : "未綁定"}` : "尚未連接（到「貼文」頁按連接 Meta 帳號）",
      });
    } catch (e: any) {
      checks.push({ name: "Meta 連線", ok: false, detail: String(e?.message ?? e) });
    }
  }
  return checks;
}
