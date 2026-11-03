"use server";

import { revalidatePath } from "next/cache";
import { archiveRecord, AUTOMATION_PREFIX, createRecord, getRecord, updateRecord } from "@/lib/notion";
import { back } from "@/lib/redirect";
import type { AutomationData, Platform } from "@/lib/types";
import { runAutomation } from "@/lib/workflow";

const PATH = "/automations";

async function run(fn: () => Promise<string>): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (e: any) {
    revalidatePath(PATH);
    back(PATH, "error", String(e?.message ?? e));
  }
  revalidatePath(PATH);
  revalidatePath("/posts");
  back(PATH, "notice", msg);
}

function parse(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const theme = String(form.get("theme") ?? "").trim();
  if (!name || !theme) throw new Error("請填寫任務名稱與主題");
  const platforms = form.getAll("platforms").map(String).filter((p): p is Platform => p === "fb" || p === "ig");
  if (platforms.length === 0) throw new Error("請至少選一個平台");
  const withImage = form.get("withImage") === "on";
  if (platforms.includes("ig") && !withImage) throw new Error("要發 Instagram 一定要勾「AI 生成配圖」");
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  const times = String(form.get("times") ?? "")
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`時間格式不正確：${t}（請用 09:00 這種格式）`);
      return `${m[1].padStart(2, "0")}:${m[2]}`;
    });
  if (days.length === 0 || times.length === 0) throw new Error("請至少選一天、填一個時間");
  return {
    name,
    theme,
    platforms,
    withImage,
    webSearch: form.get("webSearch") === "on",
    enabled: form.get("enabled") === "on",
    days,
    times: [...new Set(times)].sort(),
  };
}

export async function saveAutomation(form: FormData) {
  await run(async () => {
    const fields = parse(form);
    const id = String(form.get("id") ?? "");
    if (id) {
      const rec = await getRecord<AutomationData>(id);
      await updateRecord<AutomationData>(id, {
        title: AUTOMATION_PREFIX + fields.name,
        // 重新啟用時從現在開始算，避免補發停用期間錯過的時段
        data: {
          ...rec.data,
          ...fields,
          lastDoneSlot: fields.enabled && !rec.data.enabled ? new Date().toISOString() : rec.data.lastDoneSlot,
        },
      });
      return "已更新任務";
    }
    await createRecord<AutomationData>({
      title: AUTOMATION_PREFIX + fields.name,
      status: "草稿",
      data: { kind: "automation", ...fields, lastDoneSlot: new Date().toISOString(), runs: [] },
    });
    return "已新增任務";
  });
}

export async function runNow(form: FormData) {
  await run(async () => {
    const rec = await getRecord<AutomationData>(String(form.get("id")));
    const ok = await runAutomation(rec, null);
    if (!ok) throw new Error("執行失敗，詳情請看下方執行紀錄");
    return "已產生並發布一則貼文";
  });
}

export async function deleteAutomation(form: FormData) {
  await run(async () => {
    await archiveRecord(String(form.get("id")));
    return "已刪除任務";
  });
}
