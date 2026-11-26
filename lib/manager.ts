import {
  analyzePerformance,
  generateReelsScript,
  generateText,
  researchTrends,
  reviewCaption,
  similarTopic,
  type TrendTopic,
} from "./ai";
import { designPostImage } from "./design";
import { fetchMetrics } from "./meta";
import { DEFAULT_OFFICIAL_SOURCES, markUsed, OFFICE_NAME, officialKnowledgeFor, pendingUpdates } from "./official";
import {
  createRecord,
  MANAGER_TITLE,
  queryRecords,
  REPORT_PREFIX,
  updateRecord,
  type NotionRecord,
} from "./notion";
import { slotsBetween } from "./time";
import type { ChannelPlan, ManagerData, Pillar, Platform, PostData, PostMetrics, Reference, ReportData } from "./types";
import { listPosts } from "./workflow";

// AI 社群經理：FB、IG 分開經營。各自排內容企劃、產文、審稿、做圖，每週依各自成效調整方向。
// 實際發布交給既有的排程流程（狀態「已排程」＋發布時間），由 cron 到點發出。

export const CHANNEL_LABEL: Record<Platform, string> = { fb: "Facebook", ig: "Instagram" };

export const DEFAULT_PILLARS: Record<Platform, Pillar[]> = {
  fb: [
    { name: "澳洲時事解讀", description: "近期澳洲房市、租屋、留學、簽證與移民政策新聞，用家長的角度解讀影響與準備方式", weight: 1.4 },
    { name: "區域與學區深度介紹", description: "大學周邊區域的通勤、治安、生活機能、租金水準與居住氛圍", weight: 1 },
    { name: "留學家庭實用指南", description: "租屋流程、預算規劃、生活成本、保險與開戶等家長必知事項", weight: 1 },
    { name: "房產知識", description: "澳洲買房流程、外國人購屋規定、持有成本與稅費觀念（中性說明，不保證獲利）", weight: 0.8 },
    { name: "家長問答與討論", description: "家長最常問的問題，引導留言分享經驗", weight: 0.8 },
    { name: "品牌服務", description: "澳洲美家如何協助家庭挑房、試算成本與看房", weight: 0.4 },
  ],
  ig: [
    { name: "墨爾本街區與建案實景", description: "各區街景、建案外觀與周邊環境，讓家長看見孩子未來的生活場景", weight: 1.3 },
    { name: "留學生活日常", description: "校園周邊、市場、咖啡廳、交通等墨爾本生活感", weight: 1 },
    { name: "一圖看懂小知識", description: "租屋檢查清單、預算拆解、看房重點等值得收藏的重點整理", weight: 1 },
    { name: "居住空間", description: "採光、格局、書桌與收納等適合學生的居住空間", weight: 0.8 },
    { name: "品牌服務", description: "澳洲美家的服務與看房紀錄", weight: 0.4 },
  ],
};

const DEFAULT_CHANNELS: Record<Platform, ChannelPlan> = {
  fb: { enabled: true, days: [2, 4, 6], times: ["12:30"], pillars: DEFAULT_PILLARS.fb, notes: "", learnings: "" },
  ig: { enabled: true, days: [1, 3, 5], times: ["20:00"], pillars: DEFAULT_PILLARS.ig, notes: "", learnings: "" },
};

export const DEFAULT_REFERENCES: Reference[] = [
  {
    keywords: ["FIRB", "外國買家", "外國人", "海外買家", "外國投資", "foreign buyer", "foreign investment"],
    url: "https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1424",
    note: "澳洲聯邦法院 2026 年 FCA 1424 號判決（外國投資／FIRB 相關）",
  },
];

export const DEFAULT_MANAGER: ManagerData = {
  kind: "manager",
  enabled: false,
  channels: DEFAULT_CHANNELS,
  references: DEFAULT_REFERENCES,
  logs: [],
};

/** 主題文字提到關鍵字時，附上要參考的資料來源 */
export function matchReferences(refs: Reference[], text: string): Reference[] {
  const t = text.toLowerCase();
  return refs.filter((r) => r.keywords.some((k) => k && t.includes(k.toLowerCase())));
}

/** 舊版設定（FB、IG 共用）轉成分開經營的格式 */
export function channelsOf(m: ManagerData): Record<Platform, ChannelPlan> {
  if (m.channels) return m.channels;
  const legacy = (p: Platform): ChannelPlan => ({
    ...DEFAULT_CHANNELS[p],
    enabled: m.platforms ? m.platforms.includes(p) : true,
    notes: m.notes ?? "",
    learnings: m.learnings ?? "",
  });
  return { fb: legacy("fb"), ig: legacy("ig") };
}

const HORIZON_MS = 7 * 24 * 3600_000;
const LEAD_MS = 60 * 60_000; // 至少提前一小時產好，留緩衝
const slotKey = (p: Platform, iso: string) => `${p}|${iso}`;

export async function getManagerRecord(): Promise<NotionRecord<ManagerData> | null> {
  const rows = await queryRecords<ManagerData>({ property: "標題", title: { equals: MANAGER_TITLE } }, undefined, 1);
  return rows[0]?.data?.kind === "manager" ? rows[0] : null;
}

export async function getManager(): Promise<ManagerData> {
  const m = (await getManagerRecord())?.data ?? DEFAULT_MANAGER;
  return {
    ...m,
    channels: channelsOf(m),
    references: m.references ?? DEFAULT_REFERENCES,
    officialSources: m.officialSources ?? DEFAULT_OFFICIAL_SOURCES,
  };
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

/** 某平台未來 7 天內還沒有貼文的時段（審稿沒過的草稿最多重試兩次，之後跳過該時段） */
export function openSlots(
  platform: Platform,
  plan: ChannelPlan,
  posts: NotionRecord<PostData>[],
  nowMs = Date.now(),
): string[] {
  if (!plan.enabled) return [];
  const drafts = new Map<string, number>();
  const taken = new Set<string>();
  for (const p of posts) {
    const s = p.data.managerSlot;
    if (!s) continue;
    if (p.status === "草稿") drafts.set(s, (drafts.get(s) ?? 0) + 1);
    else taken.add(s);
  }
  for (const [s, n] of drafts) if (n >= 2) taken.add(s);
  return slotsBetween(plan.days, plan.times, nowMs + LEAD_MS, nowMs + HORIZON_MS)
    .map((t) => new Date(t).toISOString())
    .filter((iso) => !taken.has(slotKey(platform, iso)));
}

/**
 * 為最近的一個空時段（FB 或 IG）產一則貼文。通過把關就排程，沒通過就留成草稿並記錄原因。
 * trial：試產指定平台的一則，只存草稿、不排程，也不佔用時段或官方題材。
 */
export async function fillNextSlot(trial?: Platform): Promise<string | null> {
  const m = await getManager();
  const channels = channelsOf(m);
  const posts = await listPosts();
  const next = trial
    ? { platform: trial, slot: "" }
    : (["fb", "ig"] as Platform[])
        .map((p) => ({ platform: p, slot: openSlots(p, channels[p], posts)[0] }))
        .filter((x) => x.slot)
        .sort((a, b) => a.slot!.localeCompare(b.slot!))[0];
  if (!next) return null;
  const { platform } = next;
  const slot = next.slot!;
  const plan = channels[platform];
  const label = CHANNEL_LABEL[platform];

  const channelPosts = posts.filter((p) => p.data.origin === "manager" && p.data.platforms.includes(platform));
  const recentTitles = posts.slice(0, 20).map((p) => p.title);
  // 已做過的主題：近 60 天所有貼文（FB、IG 都算），避免重複
  const since = Date.now() - 60 * 24 * 3600_000;
  const covered = posts
    .filter((p) => new Date(p.createdTime).getTime() >= since)
    .flatMap((p) => [p.title, p.data.trend?.title ?? ""])
    .filter(Boolean);

  // 0) 州稅局等官方網站有新公告或規定變更、還沒寫過的，最優先
  let official: Awaited<ReturnType<typeof pendingUpdates>>[number] | undefined;
  try {
    official = (await pendingUpdates()).find(({ update }) => !covered.some((c) => similarTopic(c, update.title)));
  } catch {
    official = undefined;
  }

  // 1) 其次找近兩週最熱門、而且還沒做過的新聞議題
  let trend: TrendTopic | undefined;
  if (official) {
    const o = official;
    trend = {
      title: `${o.rec.data.state} ${o.update.title}`,
      summary: o.update.summary,
      source: OFFICE_NAME[o.rec.data.state] ?? o.rec.data.state,
      date: o.update.at.slice(0, 10),
      why: "州政府官方網站剛公布的最新規定或公告",
      angle: "說明這項官方更新對台灣買家、海外買家或留學家庭的實際影響，以及該怎麼準備",
    };
  } else {
    try {
      const trends = await researchTrends(platform, covered);
      trend = trends.find((t) => !covered.some((c) => similarTopic(c, t.title)));
    } catch {
      trend = undefined;
    }
  }

  // 2) 熱門議題都做過了（或搜尋失敗），才改用內容支柱選常青主題
  const pillar = trend
    ? { name: "熱門議題", description: trend.title, weight: 1 }
    : pickPillar(plan.pillars.length ? plan.pillars : DEFAULT_PILLARS[platform], channelPosts.map((p) => p.data.pillar ?? ""));

  const topic = [
    trend
      ? [
          `本篇主題是近兩週的熱門議題：「${trend.title}」`,
          `重點：${trend.summary}`,
          `來源：${trend.source}（${trend.date}）`,
          `為什麼熱門：${trend.why}`,
          `建議切入角度：${trend.angle}`,
          "請再上網查證這則新聞的最新內容與細節，以查證後的事實為準，文中註明資料來源與日期。",
        ].join("\n")
      : `內容支柱「${pillar.name}」：${pillar.description}\n請自己挑一個具體、目標受眾會想點開的子題。`,
    "不要與以下近期貼文重複：",
    recentTitles.map((t) => `- ${t}`).join("\n") || "（無）",
    plan.learnings ? `${label} 近期成效洞察（請參考）：\n${plan.learnings}` : "",
    plan.notes ? `經營者對 ${label} 的補充指示：\n${plan.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const refs = matchReferences(m.references ?? DEFAULT_REFERENCES, `${trend?.title ?? ""} ${trend?.summary ?? ""} ${pillar.description}`);
  const knowledge = await officialKnowledgeFor(`${trend?.title ?? ""} ${trend?.summary ?? ""} ${pillar.description}`).catch(() => "");
  const topicWithRefs = [
    topic,
    official ? `官方原文：${official.update.url}（請以官方原文為準，文末註明「資料來源：${trend?.source}（${trend?.date}）」）` : "",
    refs.length
      ? `本主題請務必參考並查證以下資料，內容與新聞報導不一致時以官方或法院資料為準，並在文末列出：\n${refs
          .map((r) => `- ${r.note}：${r.url}`)
          .join("\n")}`
      : "",
    knowledge ? `以下是系統從州稅局官方網站整理的最新重點，涉及稅率、門檻、日期時以此為準：\n${knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text = await generateText(topicWithRefs, [platform], { webSearch: true, channel: platform });
    let caption = text.caption;
    let review = await reviewCaption(caption, recentTitles);
    if (!review.pass && review.revisedCaption) {
      caption = review.revisedCaption;
      review = await reviewCaption(caption, recentTitles);
    }
    // 熱門議題或官方更新的貼文一定要有資料來源；模型漏寫就自動補在 hashtag 前
    if (review.pass && trend && !/資料來源/.test(caption)) {
      const lines = caption.trimEnd().split("\n");
      let i = lines.length;
      while (i > 0 && /^\s*#/.test(lines[i - 1])) i--;
      lines.splice(i, 0, "", `資料來源：${trend.source}（${trend.date}）`);
      caption = lines.join("\n").replace(/\n{3,}/g, "\n\n");
    }
    // 文案定稿（通過審稿）後，才依文案與主題做圖
    const design = review.pass
      ? await designPostImage({
          caption,
          topic: `${pillar.name}：${text.title}`,
          avoidPhotoIds: posts.map((p) => p.data.photo?.id).filter(Boolean) as string[],
          // IG 用輪播（封面＋內頁＋結尾互動頁），FB 用單張主視覺
          carousel: platform === "ig",
        })
      : undefined;
    const reelsScript =
      review.pass && platform === "ig" ? await generateReelsScript(text.title, caption).catch(() => undefined) : undefined;
    const rec = await createRecord<PostData>({
      title: text.title,
      status: review.pass && !trial ? "已排程" : "草稿",
      publishAt: review.pass && !trial ? slot : null,
      data: {
        kind: "post",
        topic: `${pillar.name}｜${text.title}`,
        platforms: [platform],
        caption,
        imageUrl: design?.url,
        imageUrls: design?.urls,
        photo: design?.photo,
        reelsScript,
        origin: "manager",
        pillar: pillar.name,
        managerSlot: trial ? undefined : slotKey(platform, slot),
        trend: trend ? { title: trend.title, source: trend.source, date: trend.date } : undefined,
        official: official
          ? { state: official.rec.data.state, label: official.rec.data.label, title: official.update.title, url: official.update.url }
          : undefined,
        review: { pass: review.pass, score: review.score, issues: review.issues, at: new Date().toISOString() },
      },
    });
    const msg = review.pass
      ? `${label}：${trial ? "試產草稿" : "已排程"}「${text.title}」（${official ? `官方更新：${trend?.title}` : trend ? `熱門議題：${trend.title}` : pillar.name}，審稿 ${review.score} 分）`
      : `${label}：「${text.title}」未通過審稿，留在草稿未發布：${review.issues.join("；")}`;
    if (review.pass && official && !trial) await markUsed(official.rec.id, official.update.url, official.update.at);
    await addLog(msg, review.pass, rec.id);
    return msg;
  } catch (e: any) {
    const msg = `${label} 產文失敗（${pillar.name}）：${e?.message ?? e}`;
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

/** 抓近 28 天已發布貼文的數據 → FB、IG 各自 AI 分析 → 調整各自的支柱權重 → 各寫一份成效報告。 */
export async function runWeeklyReport(): Promise<string> {
  const rec = await getManagerRecord();
  if (!rec) return "尚未啟用 AI 社群經理";
  const m = rec.data;
  const channels = channelsOf(m);
  const now = Date.now();
  const since = now - 28 * 24 * 3600_000;
  const published = (await listPosts())
    .filter((p) => p.status === "已發布" || Object.values(p.data.results ?? {}).some((r) => r?.ok))
    .filter((p) => new Date(p.publishAt ?? p.createdTime).getTime() >= since)
    .slice(0, 30);

  // 先更新每則貼文的數據
  for (const p of published) {
    const metrics: Partial<Record<Platform, PostMetrics>> = { ...(p.data.metrics ?? {}) };
    for (const [pf, r] of Object.entries(p.data.results ?? {}) as [Platform, any][]) {
      if (!r?.ok || !r.id) continue;
      const got = await fetchMetrics(pf, r.id);
      if (got) metrics[pf] = got;
    }
    p.data.metrics = metrics;
    await updateRecord<PostData>(p.id, { data: { ...p.data, metrics } });
  }

  const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const done: string[] = [];
  const nextChannels = { ...channels };
  for (const platform of ["fb", "ig"] as Platform[]) {
    const plan = channels[platform];
    const rows = published
      .filter((p) => p.data.results?.[platform]?.ok)
      .map((p) => ({
        title: p.title,
        pillar: p.data.pillar,
        engagement: engagement({ [platform]: p.data.metrics?.[platform] }),
        reach: p.data.metrics?.[platform]?.reach,
        publishedAt: p.publishAt ?? p.createdTime,
      }));
    if (rows.length === 0) continue;

    const analysis = await analyzePerformance(rows, plan.pillars.map((p) => ({ name: p.name, weight: p.weight })));
    const weightChanges: ReportData["weightChanges"] = [];
    const pillars = plan.pillars.map((p) => {
      const want = Number(analysis.weights[p.name]);
      if (!Number.isFinite(want)) return p;
      const to = Math.round(Math.min(2, Math.max(0.3, Math.min(p.weight + 0.4, Math.max(p.weight - 0.4, want)))) * 10) / 10;
      if (to !== p.weight) weightChanges.push({ pillar: p.name, from: p.weight, to });
      return { ...p, weight: to };
    });
    nextChannels[platform] = { ...plan, pillars, learnings: analysis.learnings };

    const byPillar = new Map<string, number[]>();
    for (const r of rows) {
      const k = r.pillar ?? "（手動貼文）";
      byPillar.set(k, [...(byPillar.get(k) ?? []), r.engagement]);
    }
    await createRecord<ReportData>({
      title: `${REPORT_PREFIX}${date} ${CHANNEL_LABEL[platform]}`,
      status: "草稿",
      data: {
        kind: "report",
        platform,
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
      },
    });
    done.push(`${CHANNEL_LABEL[platform]} ${rows.length} 則`);
  }

  await updateRecord<ManagerData>(rec.id, {
    data: { ...m, channels: nextChannels, lastReportAt: new Date(now).toISOString() },
  });
  return done.length ? `已產生 ${date} 成效報告（${done.join("、")}）` : "近 28 天還沒有已發布的貼文，下週再分析";
}

export async function listReports(): Promise<NotionRecord<ReportData>[]> {
  const rows = await queryRecords<ReportData>(
    { property: "標題", title: { starts_with: REPORT_PREFIX } },
    [{ timestamp: "created_time", direction: "descending" }],
    10,
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
