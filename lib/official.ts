import { createHash } from "node:crypto";
import { askJson } from "./ai";
import { createRecord, OFFICIAL_PREFIX, queryRecords, updateRecord, type NotionRecord } from "./notion";

// 官方資料監測：定期讀取三大州稅局（NSW、VIC、QLD）的重點頁面與新聞，
// 1) 把內容整理成「已學習的重點」，產文時遇到相關主題就當作查證依據；
// 2) 頁面有實質變更或出現新公告時，變成待發的社群題材。

import type { OfficialSource } from "./types";
export type { OfficialSource };

export const DEFAULT_OFFICIAL_SOURCES: OfficialSource[] = [
  { state: "NSW", label: "新聞稿", url: "https://www.revenue.nsw.gov.au/news-media-releases", kind: "news" },
  { state: "NSW", label: "土地稅", url: "https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/land-tax", kind: "page" },
  {
    state: "NSW",
    label: "海外買家附加印花稅",
    url: "https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty/surcharge-purchaser-duty",
    kind: "page",
  },
  {
    state: "NSW",
    label: "海外人士附加土地稅",
    url: "https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/land-tax/surcharge-land-tax",
    kind: "page",
  },
  { state: "VIC", label: "新聞", url: "https://www.sro.vic.gov.au/about-us/news-and-events/news", kind: "news" },
  { state: "VIC", label: "土地稅", url: "https://www.sro.vic.gov.au/land-tax", kind: "page" },
  { state: "VIC", label: "海外買家房產稅務專頁", url: "https://www.sro.vic.gov.au/buying-property/foreign-purchasers-property", kind: "page" },
  {
    state: "VIC",
    label: "海外買家附加印花稅稅率",
    url: "https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/foreign-purchaser-additional-duty-current-rates",
    kind: "page",
  },
  { state: "VIC", label: "空置業主附加土地稅", url: "https://www.sro.vic.gov.au/absentee-owner-surcharge", kind: "page" },
  { state: "QLD", label: "公告", url: "https://qro.qld.gov.au/announcements/", kind: "news" },
  { state: "QLD", label: "土地稅", url: "https://qro.qld.gov.au/land-tax/", kind: "page" },
  { state: "QLD", label: "印花稅", url: "https://qro.qld.gov.au/duties/transfer-duty/", kind: "page" },
  { state: "QLD", label: "海外買家附加印花稅（AFAD）", url: "https://qro.qld.gov.au/duties/investors/afad/", kind: "page" },
  { state: "QLD", label: "海外人士附加土地稅豁免", url: "https://qro.qld.gov.au/land-tax/foreign-surcharge/", kind: "page" },
];

export const OFFICE_NAME: Record<string, string> = {
  NSW: "新南威爾斯州稅局（Revenue NSW）",
  VIC: "維多利亞州稅局（SRO Victoria）",
  QLD: "昆士蘭州稅局（QRO）",
};

export type OfficialUpdate = { at: string; title: string; summary: string; url: string; usedAt?: string };

export type OfficialSnapshot = {
  kind: "official";
  state: string;
  label: string;
  url: string;
  sourceKind: "news" | "page";
  hash?: string;
  /** 頁面正文（截斷），用來比對變更 */
  text?: string;
  /** 已學習的重點（繁中） */
  summary?: string;
  /** 新聞頁：已看過的文章網址 */
  seen?: string[];
  checkedAt?: string;
  changedAt?: string;
  error?: string;
  updates: OfficialUpdate[];
};

const UA = "Mozilla/5.0 (compatible; social-autopilot/1.0; +https://github.com/jerry0979361111-del/social-autopilot)";
const MAX_TEXT = 12000;
const RECHECK_MS = 20 * 3600_000;

export async function listSnapshots(): Promise<NotionRecord<OfficialSnapshot>[]> {
  const rows = await queryRecords<OfficialSnapshot>(
    { property: "標題", title: { starts_with: OFFICIAL_PREFIX } },
    [{ timestamp: "created_time", direction: "ascending" }],
    100,
  );
  return rows.filter((r) => r.data?.kind === "official");
}

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** 取出頁面主要內容（main 區塊），去掉選單、頁首頁尾與程式碼 */
function mainHtml(html: string): string {
  const m = /<main[\s\S]*?<\/main>/i.exec(html) ?? /<article[\s\S]*?<\/article>/i.exec(html);
  // 不能去掉 <form>：有些新聞列表整個包在篩選表單裡
  return (m ? m[0] : html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|nav|header|footer|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "");
}

export function toText(html: string): string {
  return decode(mainHtml(html).replace(/<(br|\/p|\/li|\/h\d|\/tr|\/div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n")
    .slice(0, MAX_TEXT);
}

/** 新聞頁：抓出文章連結（同站、比列表頁更深一層的網址） */
export function articleLinks(html: string, pageUrl: string): { title: string; url: string }[] {
  const base = new URL(pageUrl);
  const out = new Map<string, string>();
  for (const m of mainHtml(html).matchAll(/<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    const path = url.pathname.replace(/\/$/, "");
    const listPath = base.pathname.replace(/\/$/, "");
    const underList = path.startsWith(listPath + "/") && path.split("/").length > listPath.split("/").length;
    const dated = /\/20\d\d\/\d\d\/[^/]+$/.test(path); // 例如 QRO 的 /2026/11/文章
    if (url.host !== base.host || !(underList || dated)) continue;
    if (/subscribe|page=|\/(tag|category)\//i.test(url.href)) continue;
    const title = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (title.length >= 8 && !out.has(url.href)) out.set(url.href, title);
  }
  return [...out].map(([url, title]) => ({ url, title })).slice(0, 30);
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`讀取失敗 HTTP ${res.status}`);
  return res.text();
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

async function learn(src: OfficialSource, text: string): Promise<string> {
  const r = await askJson<{ summary: string }>(
    [
      `你在整理 ${OFFICE_NAME[src.state] ?? src.state} 官方網站「${src.label}」頁面的重點，給台灣的澳洲置產客戶與留學家長參考。`,
      "用繁體中文條列 5～12 點：適用對象、稅率或金額、門檻、計算方式、豁免或優惠、截止日與生效日、申報或繳納方式。",
      "只寫頁面上明確寫出的內容，保留原本的數字、百分比與日期，不要推測或補充頁面沒寫的事。",
      '只輸出 JSON：{"summary":"・第一點\\n・第二點"}',
    ].join("\n"),
    `網址：${src.url}\n\n頁面內容：\n${text}`,
  );
  return String(r.summary ?? "");
}

async function compare(src: OfficialSource, oldText: string, newText: string) {
  return askJson<{ substantive: boolean; title: string; summary: string }>(
    [
      `比較 ${OFFICE_NAME[src.state] ?? src.state}「${src.label}」頁面的舊版與新版內容。`,
      "只有稅率、金額、門檻、適用對象、豁免、日期、規定或流程等實質內容改變才算 substantive=true；版面、導覽、日期戳記、錯字修正都不算。",
      "若為實質變更：title 用 20 字內繁中寫出變了什麼；summary 用繁中 2～5 句說明舊規定、新規定、生效日與影響對象（只寫頁面上有的內容）。",
      '只輸出 JSON：{"substantive":true,"title":"...","summary":"..."}',
    ].join("\n"),
    `【舊版】\n${oldText.slice(0, 5000)}\n\n【新版】\n${newText.slice(0, 5000)}`,
  );
}

async function summarizeArticle(src: OfficialSource, title: string, url: string): Promise<OfficialUpdate> {
  let text = "";
  try {
    text = toText(await fetchHtml(url));
  } catch {
    // 讀不到內文就只用標題
  }
  const r = await askJson<{ title: string; summary: string }>(
    [
      `這是 ${OFFICE_NAME[src.state] ?? src.state} 的最新公告。用繁體中文整理給台灣的澳洲置產客戶與留學家長：`,
      "title：20 字內說明公告重點；summary：2～5 句說明內容、生效日、影響對象與該注意的事。只寫原文有的內容。",
      '只輸出 JSON：{"title":"...","summary":"..."}',
    ].join("\n"),
    `標題：${title}\n網址：${url}\n\n內文：\n${text.slice(0, 6000) || "（無法讀取內文）"}`,
  );
  return { at: new Date().toISOString(), title: String(r.title || title), summary: String(r.summary ?? ""), url };
}

/** 檢查一個來源：第一次讀取只學習，之後有新公告或實質變更才產生待發題材。 */
async function checkSource(src: OfficialSource, rec: NotionRecord<OfficialSnapshot> | undefined): Promise<string> {
  const prev = rec?.data;
  const now = new Date().toISOString();
  const base: OfficialSnapshot = prev ?? {
    kind: "official",
    state: src.state,
    label: src.label,
    url: src.url,
    sourceKind: src.kind,
    updates: [],
  };
  let next: OfficialSnapshot = { ...base, url: src.url, sourceKind: src.kind, checkedAt: now, error: undefined };
  let note = "";
  try {
    const html = await fetchHtml(src.url);
    const text = toText(html);
    const h = hash(text);
    const updates = [...(base.updates ?? [])];

    if (src.kind === "news") {
      const links = articleLinks(html, src.url);
      const seen = new Set(base.seen ?? []);
      const fresh = prev?.seen ? links.filter((l) => !seen.has(l.url)).slice(0, 3) : [];
      for (const l of fresh) updates.unshift(await summarizeArticle(src, l.title, l.url));
      next = { ...next, seen: [...new Set([...links.map((l) => l.url), ...(base.seen ?? [])])].slice(0, 200) };
      if (!prev?.summary || h !== prev.hash) next.summary = links.slice(0, 10).map((l) => `・${l.title}`).join("\n");
      note = prev?.seen ? `${fresh.length} 則新公告` : `已記錄 ${links.length} 則現有公告`;
      if (fresh.length) next.changedAt = now;
    } else if (!prev?.hash) {
      next.summary = await learn(src, text);
      note = "首次學習完成";
    } else if (h !== prev.hash) {
      const c = await compare(src, prev.text ?? "", text);
      if (c.substantive) {
        updates.unshift({ at: now, title: String(c.title), summary: String(c.summary), url: src.url });
        next.summary = await learn(src, text);
        next.changedAt = now;
        note = `實質變更：${c.title}`;
      } else note = "版面小改，無實質變更";
    } else note = "沒有變更";

    next = { ...next, hash: h, text, updates: updates.slice(0, 10) };
  } catch (e: any) {
    next.error = String(e?.message ?? e);
    note = `錯誤：${next.error}`;
  }

  if (rec) await updateRecord<OfficialSnapshot>(rec.id, { data: next });
  else await createRecord<OfficialSnapshot>({ title: `${OFFICIAL_PREFIX}${src.state} ${src.label}`, status: "草稿", data: next });
  return `${src.state} ${src.label}：${note}`;
}

/** 依序檢查到期（超過 20 小時沒檢查）的來源，時間不夠就留給下一次 cron。 */
export async function checkOfficialSources(
  sources: OfficialSource[],
  timeLeft: () => number,
  force = false,
): Promise<string[]> {
  const snaps = await listSnapshots();
  const out: string[] = [];
  for (const src of sources) {
    if (timeLeft() < 45_000) break;
    const rec = snaps.find((s) => s.data.url === src.url);
    if (!force && rec?.data.checkedAt && Date.now() - new Date(rec.data.checkedAt).getTime() < RECHECK_MS) continue;
    out.push(await checkSource(src, rec));
  }
  return out;
}

/** 還沒寫成貼文的官方更新（近 30 天），最新的在前 */
export async function pendingUpdates(): Promise<{ rec: NotionRecord<OfficialSnapshot>; update: OfficialUpdate }[]> {
  const since = Date.now() - 30 * 24 * 3600_000;
  return (await listSnapshots())
    .flatMap((rec) => (rec.data.updates ?? []).map((update) => ({ rec, update })))
    .filter(({ update }) => !update.usedAt && new Date(update.at).getTime() >= since)
    .sort((a, b) => b.update.at.localeCompare(a.update.at));
}

export async function markUsed(recId: string, updateUrl: string, updateAt: string): Promise<void> {
  const rec = (await listSnapshots()).find((r) => r.id === recId);
  if (!rec) return;
  const updates = rec.data.updates.map((u) => (u.url === updateUrl && u.at === updateAt ? { ...u, usedAt: new Date().toISOString() } : u));
  await updateRecord<OfficialSnapshot>(rec.id, { data: { ...rec.data, updates } });
}

const STATE_WORDS: Record<string, RegExp> = {
  NSW: /nsw|新南威爾斯|新州|雪梨|悉尼|sydney/i,
  VIC: /vic|維多利亞|維州|墨爾本|melbourne/i,
  QLD: /qld|昆士蘭|昆州|布里斯本|黃金海岸|brisbane|gold coast/i,
};
const TAX_WORDS = /稅|印花|土地稅|附加|海外買家|外國買家|外國人|firb|duty|land tax|surcharge|foreign|absentee/i;

/** 主題跟州稅務有關時，回傳已學習的官方重點，產文時當作查證依據。 */
export async function officialKnowledgeFor(topic: string): Promise<string> {
  if (!TAX_WORDS.test(topic)) return "";
  const states = Object.keys(STATE_WORDS).filter((s) => STATE_WORDS[s].test(topic));
  const snaps = (await listSnapshots()).filter(
    (s) => s.data.summary && s.data.sourceKind === "page" && (states.length === 0 || states.includes(s.data.state)),
  );
  if (snaps.length === 0) return "";
  return snaps
    .slice(0, 6)
    .map(
      (s) =>
        `【${OFFICE_NAME[s.data.state] ?? s.data.state}｜${s.data.label}】（${s.data.url}，查核日期 ${(s.data.checkedAt ?? "").slice(0, 10)}）\n${s.data.summary}`,
    )
    .join("\n\n");
}
