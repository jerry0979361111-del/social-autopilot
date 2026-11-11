"use server";

import { revalidatePath } from "next/cache";
import { fillNextSlot, getManager, runWeeklyReport, saveManager } from "@/lib/manager";
import { back } from "@/lib/redirect";
import type { Pillar, Platform } from "@/lib/types";

const PATH = "/manager";

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

function parsePillars(text: string): Pillar[] {
  const pillars = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, description = "", weight = "1"] = line.split(/[｜|]/).map((x) => x.trim());
      const w = Number(weight);
      return { name, description, weight: Number.isFinite(w) ? Math.min(2, Math.max(0.3, w)) : 1 };
    })
    .filter((p) => p.name);
  if (pillars.length === 0) throw new Error("至少要有一個內容支柱");
  return pillars;
}

export async function saveSettings(form: FormData) {
  await run(async () => {
    const m = await getManager();
    const platforms = form.getAll("platforms").map(String).filter((p): p is Platform => p === "fb" || p === "ig");
    if (platforms.length === 0) throw new Error("請至少選一個平台");
    const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
    const times = String(form.get("times") ?? "")
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map((t) => {
        const x = /^(\d{1,2}):(\d{2})$/.exec(t);
        if (!x || Number(x[1]) > 23 || Number(x[2]) > 59) throw new Error(`時間格式不正確：${t}`);
        return `${x[1].padStart(2, "0")}:${x[2]}`;
      });
    if (days.length === 0 || times.length === 0) throw new Error("請至少選一天、填一個時間");
    await saveManager({
      ...m,
      enabled: form.get("enabled") === "on",
      platforms,
      days,
      times: [...new Set(times)].sort(),
      pillars: parsePillars(String(form.get("pillars") ?? "")),
      notes: String(form.get("notes") ?? "").trim(),
    });
    return form.get("enabled") === "on"
      ? "已儲存並啟用。之後每次 cron 會自動補齊未來 7 天的貼文"
      : "已儲存（目前為停用）";
  });
}

export async function fillNow() {
  await run(async () => {
    const msg = await fillNextSlot();
    return msg ?? "未來 7 天的時段都已經排滿了";
  });
}

export async function reportNow() {
  await run(runWeeklyReport);
}
