import { generateImage, generateText } from "./ai";
import { runManager } from "./manager";
import { publishToPlatforms } from "./meta";
import {
  AUTOMATION_PREFIX,
  createRecord,
  getRecord,
  queryRecords,
  titleIsReserved,
  updateRecord,
  type NotionRecord,
} from "./notion";
import { slotsBetween } from "./time";
import type { AutomationData, Platform, PostData } from "./types";

// ---------- 貼文 ----------

export async function listPosts(): Promise<NotionRecord<PostData>[]> {
  const rows = await queryRecords<PostData>(undefined, [{ timestamp: "created_time", direction: "descending" }], 60);
  return rows.filter((r) => !titleIsReserved(r.title));
}

export async function createDraft(input: {
  topic: string;
  platforms: Platform[];
  withImage: boolean;
  webSearch?: boolean;
  imageUrl?: string;
  automationId?: string;
}): Promise<NotionRecord<PostData>> {
  const text = await generateText(input.topic, input.platforms, { webSearch: input.webSearch });
  let imageUrl = input.imageUrl;
  if (!imageUrl && input.withImage) imageUrl = await generateImage(text.imagePrompt);
  return createRecord<PostData>({
    title: text.title,
    status: "草稿",
    data: {
      kind: "post",
      topic: input.topic,
      platforms: input.platforms,
      caption: text.caption,
      imageUrl,
      automationId: input.automationId,
    },
  });
}

/** 發布一則貼文。已成功的平台不會重發，只補發失敗或尚未發的平台。 */
export async function publishRecord(id: string): Promise<NotionRecord<PostData>> {
  const rec = await getRecord<PostData>(id);
  const data = rec.data;
  const pending = data.platforms.filter((p) => !data.results?.[p]?.ok);
  if (pending.length === 0) return updateRecord(id, { status: "已發布" });

  await updateRecord(id, { status: "發布中" });
  const results = { ...(data.results ?? {}), ...(await publishToPlatforms(data, pending)) };
  const allOk = data.platforms.every((p) => results[p]?.ok);
  return updateRecord<PostData>(id, { status: allOk ? "已發布" : "發布失敗", data: { ...data, results } });
}

// ---------- 自動化任務 ----------

export async function listAutomations(): Promise<NotionRecord<AutomationData>[]> {
  const rows = await queryRecords<AutomationData>(
    { property: "標題", title: { starts_with: AUTOMATION_PREFIX } },
    [{ timestamp: "created_time", direction: "ascending" }],
  );
  return rows.filter((r) => r.data?.kind === "automation");
}

/**
 * 執行一次自動化：產文 → 產圖 → 發布，並寫入執行紀錄。
 * 任一平台成功就視為這個時段完成（不會重複發文）；全部失敗則留給下一次 cron 重試。
 */
export async function runAutomation(rec: NotionRecord<AutomationData>, slotIso: string | null): Promise<boolean> {
  const a = rec.data;
  let ok = false;
  let postId: string | undefined;
  let message: string;
  try {
    const draft = await createDraft({
      topic: a.theme,
      platforms: a.platforms,
      withImage: a.withImage,
      webSearch: a.webSearch,
      automationId: rec.id,
    });
    postId = draft.id;
    const published = await publishRecord(draft.id);
    const results = published.data.results ?? {};
    ok = a.platforms.some((p) => results[p]?.ok);
    message = a.platforms
      .map((p) => `${p.toUpperCase()}: ${results[p]?.ok ? "成功" : results[p]?.error ?? "未發布"}`)
      .join("；");
  } catch (e: any) {
    message = String(e?.message ?? e);
  }

  const fresh = await getRecord<AutomationData>(rec.id);
  const runs = [
    { at: new Date().toISOString(), slot: slotIso ?? "手動執行", ok, postId, message: message.slice(0, 500) },
    ...(fresh.data.runs ?? []),
  ].slice(0, 20);
  await updateRecord<AutomationData>(rec.id, {
    data: { ...fresh.data, runs, ...(ok && slotIso ? { lastDoneSlot: slotIso } : {}) },
  });
  return ok;
}

/** 找出這個任務「現在該發」的時段：最近 24 小時內、晚於上次完成的最新一個時段。 */
export function dueSlot(a: AutomationData, nowMs: number): string | null {
  if (!a.enabled || a.days.length === 0 || a.times.length === 0) return null;
  const from = Math.max(nowMs - 24 * 3600_000, a.lastDoneSlot ? new Date(a.lastDoneSlot).getTime() + 1 : 0);
  const slots = slotsBetween(a.days, a.times, from, nowMs);
  return slots.length ? new Date(slots[slots.length - 1]).toISOString() : null;
}

// ---------- cron 主流程 ----------

export async function runCron(budgetMs = 240_000) {
  const started = Date.now();
  const timeLeft = () => budgetMs - (Date.now() - started);
  const report: { posts: string[]; manager: string[]; automations: string[]; recovered: string[] } = {
    posts: [],
    manager: [],
    automations: [],
    recovered: [],
  };

  // 1) 卡在「發布中」超過 15 分鐘的（例如上次執行逾時），標記為失敗，可再手動補發
  const stuck = await queryRecords<PostData>({ property: "狀態", select: { equals: "發布中" } });
  for (const r of stuck) {
    if (Date.now() - new Date(r.lastEditedTime).getTime() > 15 * 60_000) {
      await updateRecord(r.id, { status: "發布失敗" });
      report.recovered.push(r.title);
    }
  }

  // 2) 到點的排程貼文
  const due = await queryRecords<PostData>(
    {
      and: [
        { property: "狀態", select: { equals: "已排程" } },
        { property: "發布時間", date: { on_or_before: new Date().toISOString() } },
      ],
    },
    [{ property: "發布時間", direction: "ascending" }],
    20,
  );
  for (const r of due) {
    if (timeLeft() < 60_000) break;
    const res = await publishRecord(r.id);
    report.posts.push(`${r.title} → ${res.status}`);
  }

  // 3) AI 社群經理：每週成效分析、補齊未來 7 天的貼文
  try {
    report.manager = await runManager(timeLeft);
  } catch (e: any) {
    report.manager = [`錯誤：${e?.message ?? e}`];
  }

  // 4) 到點的自動化任務（每個要產文產圖，較花時間）
  for (const a of await listAutomations()) {
    if (timeLeft() < 150_000) break;
    const slot = dueSlot(a.data, Date.now());
    if (!slot) continue;
    const ok = await runAutomation(a, slot);
    report.automations.push(`${a.data.name} → ${ok ? "成功" : "失敗（下次重試）"}`);
  }

  return report;
}
