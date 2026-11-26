"use server";

import { revalidatePath } from "next/cache";
import { CHANNEL_LABEL, fillNextSlot, getManager, runWeeklyReport, saveManager } from "@/lib/manager";
import { back } from "@/lib/redirect";
import type { ChannelPlan, Pillar, Platform, Reference } from "@/lib/types";

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

function parseChannel(form: FormData, p: Platform): ChannelPlan {
  const enabled = form.get(`${p}_enabled`) === "on";
  const days = form.getAll(`${p}_days`).map(Number).filter((d) => d >= 0 && d <= 6);
  const times = String(form.get(`${p}_times`) ?? "")
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((t) => {
      const x = /^(\d{1,2}):(\d{2})$/.exec(t);
      if (!x || Number(x[1]) > 23 || Number(x[2]) > 59) throw new Error(`${CHANNEL_LABEL[p]} 時間格式不正確：${t}`);
      return `${x[1].padStart(2, "0")}:${x[2]}`;
    });
  if (enabled && (days.length === 0 || times.length === 0))
    throw new Error(`${CHANNEL_LABEL[p]} 請至少選一天、填一個時間`);
  return {
    enabled,
    days,
    times: [...new Set(times)].sort(),
    pillars: parsePillars(String(form.get(`${p}_pillars`) ?? "")),
    notes: String(form.get(`${p}_notes`) ?? "").trim(),
    learnings: String(form.get(`${p}_learnings`) ?? ""),
  };
}

export async function saveSettings(form: FormData) {
  await run(async () => {
    const m = await getManager();
    const channels = { fb: parseChannel(form, "fb"), ig: parseChannel(form, "ig") };
    const enabled = form.get("enabled") === "on";
    const references: Reference[] = String(form.get("references") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [kw = "", url = "", ...note] = l.split(/[｜|]/).map((x) => x.trim());
        return { keywords: kw.split(/[,，、]/).map((k) => k.trim()).filter(Boolean), url, note: note.join(" ") || url };
      })
      .filter((r) => r.keywords.length && /^https?:\/\//.test(r.url));
    // 舊版欄位不再使用
    const { platforms, days, times, pillars, notes, learnings, ...rest } = m;
    await saveManager({ ...rest, enabled, channels, references });
    return enabled ? "已儲存並啟用。之後每次 cron 會自動補齊 FB、IG 未來 7 天的貼文" : "已儲存（目前為停用）";
  });
}

export async function fillNow() {
  await run(async () => {
    const msg = await fillNextSlot();
    return msg ?? "未來 7 天的時段都已經排滿了";
  });
}

export async function trialPost(form: FormData) {
  await run(async () => {
    const platform = form.get("platform") === "fb" ? "fb" : "ig";
    return (await fillNextSlot(platform)) ?? "沒有產出";
  });
}

export async function reportNow() {
  await run(runWeeklyReport);
}
