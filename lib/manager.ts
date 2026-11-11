import { analyzePerformance, generateImage, generateText, reviewCaption } from "./ai";
import { fetchMetrics } from "./meta";
import {
  createRecord,
  MANAGER_TITLE,
  queryRecords,
  REPORT_PREFIX,
  updateRecord,
  type NotionRecord,
} from "./notion";
import { slotsBetween } from "./time";
import type { ManagerData, Pillar, Platform, PostData, PostMetrics, ReportData } from "./types";
import { listPosts } from "./workflow";

// AI 社群經理：自己排內容企劃、產文產圖、發布前把關、每週依成效調整方向。
// 實際發布交給既有的排程流程（狀態「已排程」＋發布時間），由 cron 到點發出。

export const DEFAULT_PILLARS: Pillar[] = [
  { name: "留學生活與適應", description: "孩子到墨爾本的生活、安全、飲食、交通與適應建議", weight: 1.2 },
  { name: "學區與區域介紹", description: "大學周邊區域的通勤、生活機能與居住氛圍", weight: 1 },
  { name: "住宿選擇", description: "租屋、學生公寓與買房的比較與注意事項", weight: 1 },
  { name: "房產知識", description: "澳洲買房流程、持有成本、稅費與貸款觀念（中性說明，不保證獲利）", weight: 0.8 },
  { name: "家長心聲與規劃", description: "家長的擔心、陪讀、畢業後工作與長期規劃", weight: 0.8 },
  { name: "品牌與服務", description: "澳洲美家如何協助家庭挑房、試算成本與看房", weight: 0.4 },
];

export const DEFAULT_MANAGER: ManagerData = {
  kind: "manager",
  enabled: false,
  platforms: ["ig", "fb"],
  days: [1, 3, 5],
  times: ["20:00"],
  pillars: DEFAULT_PILLARS,
  notes: "",
  learnings: "",
  logs: [],
};

const HORIZON_MS = 7 * 24 * 3600_000;
const LEAD_MS = 60 * 60_000; // 至少提前一小時產好，留緩衝

export async function getManagerRecord(): Promise<NotionRecord<ManagerData> | null> {
  const rows = await queryRecords<ManagerData>({ property: "標題", title: { equals: MANAGER_TITLE } }, undefined, 1);
  return rows[0]?.data?.kind === "manager" ? rows[0] : null;
}

export async function getManager(): Promise<ManagerData> {
  return (await getManagerRecord())?.data ?? DEFAULT_MANAGER;
}

export async function saveManager(data: ManagerData): Promise<void> {
  const rec = await getManagerRecord();
  if (rec) await updateRecord(rec.id, { data });
  else await createRecord({ title: MANAGER_TITLE, status: "草稿", data });
}

async function addLog(message: string, ok: boolean, postId?: string) {
  const rec = await getManagerRecord();
  if (!rec) return;
  const logs = [{ at: new Date().toISOString(), ok, message: message.slice(0, 500), postId }, ...(rec.data.logs ?? [])];
  await updateRecord<ManagerData>(rec.id, { data: { ...rec.data, logs: logs.slice(0, 30) } });
}

function pickPillar(pillars: Pillar[], recentPillars: string[]): Pillar {
  // 最近兩則用過的支柱降低機率，讓主題輪替
  const weighted = pillars.map((p) => ({
    p,
    w: Math.max(0.05, p.weight) * (recentPillars.slice(0, 2).includes(p.name) ? 0.3 : 1),
  }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.p;
  }
  return weighted[weighted.length - 1].p;
}

/** 未來 7 天內，還沒有貼文的排程時段（審稿沒過的草稿最多重試兩次，之後跳過該時段） */
export function openSlots(m: ManagerData, posts: NotionRecord<PostData>[], nowMs = Date.now()): string[] {
  const drafts = new Map<string, number>();
  const taken = new Set<string>();
  for (const p of posts) {
    const s = p.data.managerSlot;
    if (!s) continue;
    if (p.status === "草稿") drafts.set(s, (drafts.get(s) ?? 0) + 1);
    else taken.add(s);
  }
  for (const [s, n] of drafts) if (n >= 2) taken.add(s);
  return slotsBetween(m.days, m.times, nowMs + LEAD_MS, nowMs + HORIZON_MS)
    .map((t) => new Date(t).toISOString())
    .filter((s) => !taken.has(s));
}

/** 為最近一個空時段產一則貼文。通過把關就排程，沒通過就留成草稿並記錄原因。 */
export async function fillNextSlot(): Promise<string | null> {
  const m = await getManager();
  const posts = await listPosts();
  const slot = openSlots(m, posts)[0];
  if (!slot) return null;

  const managerPosts = posts.filter((p) => p.data.origin === "manager");
  const recentTitles = posts.slice(0, 20).map((p) => p.title);
  const pillar = pickPillar(m.pillars.length ? m.pillars : DEFAULT_PILLARS, managerPosts.map((p) => p.data.pillar ?? ""));
  const platforms: Platform[] = m.platforms.length ? m.platforms : ["ig", "fb"];

  const topic = [
    `內容支柱「${pillar.name}」：${pillar.description}`,
    "請自己挑一個具體、目標受眾會想點開的子題，不要與以下近期貼文重複：",
    recentTitles.map((t) => `- ${t}`).join("\n") || "（無）",
    m.learnings ? `近期成效洞察（請參考）：\n${m.learnings}` : "",
    m.notes ? `經營者補充指示：\n${m.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text = await generateText(topic, platforms, { webSearch: true });
    let caption = text.caption;
    let review = await reviewCaption(caption, recentTitles);
    if (!review.pass && review.revisedCaption) {
      caption = review.revisedCaption;
      review = await reviewCaption(caption, recentTitles);
    }
    const imageUrl = review.pass ? await generateImage(text.imagePrompt) : undefined;
    const rec = await createRecord<PostData>({
      title: text.title,
      status: review.pass ? "已排程" : "草稿",
      publishAt: review.pass ? slot : null,
      data: {
        kind: "post",
        topic: `${pillar.name}｜${text.title}`,
        platforms,
        caption,
        imageUrl,
        origin: "manager",
        pillar: pillar.name,
        managerSlot: slot,
        review: { pass: review.pass, score: review.score, issues: review.issues, at: new Date().toISOString() },
      },
    });
    const msg = review.pass
      ? `已排程「${text.title}」（${pillar.name}，審稿 ${review.score} 分）`
      : `「${text.title}」未通過審稿，留在草稿未發布：${review.issues.join("；")}`;
    await addLog(msg, review.pass, rec.id);
    return msg;
  } catch (e: any) {
    const msg = `產文失敗（${pillar.name}）：${e?.message ?? e}`;
    await addLog(msg, false);
    return msg;
  }
}

// ---------- 成效分析 ----------

function engagement(m?: Partial<Record<Platform, PostMetrics>>): number {
  let s = 0;
  for (const x of Object.values(m ?? {})) {
    if (!x) continue;
    s += (x.likes ?? 0) + 2 * (x.comments ?? 0) + 3 * (x.shares ?? 0) + 3 * (x.saves ?? 0);
  }
  return s;
}

export function reportDue(m: ManagerData, nowMs = Date.now()): boolean {
  return !m.lastReportAt || nowMs - new Date(m.lastReportAt).getTime() > 7 * 24 * 3600_000 - 30 * 60_000;
}

/** 抓近 28 天已發布貼文的數據 → AI 分析 → 調整支柱權重 → 寫成效報告。 */
export async function runWeeklyReport(): Promise<string> {
  const rec = await getManagerRecord();
  if (!rec) return "尚未啟用 AI 社群經理";
  const m = rec.data;
  const now = Date.now();
  const since = now - 28 * 24 * 3600_000;
  const published = (await listPosts())
    .filter((p) => p.status === "已發布" || Object.values(p.data.results ?? {}).some((r) => r?.ok))
    .filter((p) => new Date(p.publishAt ?? p.createdTime).getTime() >= since)
    .slice(0, 20);

  const rows = [];
  for (const p of published) {
    const metrics: Partial<Record<Platform, PostMetrics>> = { ...(p.data.metrics ?? {}) };
    for (const [pf, r] of Object.entries(p.data.results ?? {}) as [Platform, any][]) {
      if (!r?.ok || !r.id) continue;
      const got = await fetchMetrics(pf, r.id);
      if (got) metrics[pf] = got;
    }
    await updateRecord<PostData>(p.id, { data: { ...p.data, metrics } });
    rows.push({
      title: p.title,
      pillar: p.data.pillar,
      engagement: engagement(metrics),
      reach: Object.values(metrics).reduce((s, x) => s + (x?.reach ?? 0), 0) || undefined,
      publishedAt: p.publishAt ?? p.createdTime,
    });
  }

  if (rows.length === 0) {
    await updateRecord<ManagerData>(rec.id, { data: { ...m, lastReportAt: new Date(now).toISOString() } });
    return "近 28 天還沒有已發布的貼文，下週再分析";
  }

  const analysis = await analyzePerformance(rows, m.pillars.map((p) => ({ name: p.name, weight: p.weight })));
  const weightChanges: ReportData["weightChanges"] = [];
  const pillars = m.pillars.map((p) => {
    const want = Number(analysis.weights[p.name]);
    if (!Number.isFinite(want)) return p;
    const to = Math.round(Math.min(2, Math.max(0.3, Math.min(p.weight + 0.4, Math.max(p.weight - 0.4, want)))) * 10) / 10;
    if (to !== p.weight) weightChanges.push({ pillar: p.name, from: p.weight, to });
    return { ...p, weight: to };
  });

  const byPillar = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.pillar ?? "（手動貼文）";
    byPillar.set(k, [...(byPillar.get(k) ?? []), r.engagement]);
  }
  const report: ReportData = {
    kind: "report",
    periodStart: new Date(since).toISOString(),
    periodEnd: new Date(now).toISOString(),
    summary: analysis.summary,
    learnings: analysis.learnings,
    pillarStats: [...byPillar.entries()].map(([pillar, xs]) => ({
      pillar,
      posts: xs.length,
      avgEngagement: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10,
    })),
    topPosts: [...rows].sort((a, b) => b.engagement - a.engagement).slice(0, 5),
    weightChanges,
  };
  const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  await createRecord<ReportData>({ title: `${REPORT_PREFIX}${date}`, status: "草稿", data: report });
  await updateRecord<ManagerData>(rec.id, {
    data: { ...m, pillars, learnings: analysis.learnings, lastReportAt: new Date(now).toISOString() },
  });
  return `已產生 ${date} 成效報告（分析 ${rows.length} 則貼文）`;
}

export async function listReports(): Promise<NotionRecord<ReportData>[]> {
  const rows = await queryRecords<ReportData>(
    { property: "標題", title: { starts_with: REPORT_PREFIX } },
    [{ timestamp: "created_time", direction: "descending" }],
    5,
  );
  return rows.filter((r) => r.data?.kind === "report");
}

/** cron 每次呼叫：到期就做週報，再補一個空時段。 */
export async function runManager(timeLeft: () => number): Promise<string[]> {
  const rec = await getManagerRecord();
  if (!rec?.data.enabled) return [];
  const out: string[] = [];
  if (reportDue(rec.data) && timeLeft() > 120_000) out.push(await runWeeklyReport());
  if (timeLeft() > 150_000) {
    const msg = await fillNextSlot();
    if (msg) out.push(msg);
  }
  return out;
}
