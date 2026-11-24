"use server";

import { revalidatePath } from "next/cache";
import { getManager, saveManager } from "@/lib/manager";
import { backfillRecent, checkOfficialSources, skipUpdate } from "@/lib/official";
import { back } from "@/lib/redirect";
import type { OfficialSource } from "@/lib/types";

const PATH = "/official";

async function run(fn: () => Promise<string>): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (e: any) {
    revalidatePath(PATH);
    back(PATH, "error", String(e?.message ?? e));
  }
  revalidatePath(PATH);
  back(PATH, "notice", msg);
}

export async function checkNow() {
  await run(async () => {
    const m = await getManager();
    const started = Date.now();
    const out = await checkOfficialSources(m.officialSources ?? [], () => 250_000 - (Date.now() - started), true);
    const total = m.officialSources?.length ?? 0;
    return `${out.join("；")}${out.length < total ? `（還有 ${total - out.length} 個來源下次 cron 會接著檢查）` : ""}`;
  });
}

export async function saveSources(form: FormData) {
  await run(async () => {
    const sources: OfficialSource[] = String(form.get("sources") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [state = "", label = "", url = "", kind = "page"] = l.split(/[｜|]/).map((x) => x.trim());
        return { state: state.toUpperCase(), label, url, kind: kind === "news" ? "news" : "page" } as OfficialSource;
      });
    const bad = sources.filter((s) => !s.state || !s.label || !/^https?:\/\//.test(s.url));
    if (bad.length) throw new Error(`格式不正確：${bad.map((b) => b.label || b.url).join("、")}（每行：州｜名稱｜網址｜news 或 page）`);
    const m = await getManager();
    await saveManager({ ...m, officialSources: sources });
    return `已儲存 ${sources.length} 個官方來源`;
  });
}

export async function backfill() {
  await run(async () => {
    const m = await getManager();
    const started = Date.now();
    const out = await backfillRecent(m.officialSources ?? [], 30, () => 250_000 - (Date.now() - started));
    return `已把近 30 天的相關公告標成待發 — ${out.join("；")}`;
  });
}

export async function skip(form: FormData) {
  await run(async () => {
    await skipUpdate(String(form.get("rec")), String(form.get("url")), String(form.get("at")));
    return "已略過，這則不會寫成貼文";
  });
}
