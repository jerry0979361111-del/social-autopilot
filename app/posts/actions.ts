"use server";

import { revalidatePath } from "next/cache";
import { uploadImage } from "@/lib/ai";
import { getConnection, saveConnection } from "@/lib/meta";
import { archiveRecord, getRecord, updateRecord } from "@/lib/notion";
import { back } from "@/lib/redirect";
import { taipeiLocalToIso } from "@/lib/time";
import type { Platform, PostData } from "@/lib/types";
import { createDraft, publishRecord } from "@/lib/workflow";

const PATH = "/posts";

function platformsFrom(form: FormData): Platform[] {
  const ps = form.getAll("platforms").map(String).filter((p): p is Platform => p === "fb" || p === "ig");
  if (ps.length === 0) throw new Error("請至少選一個平台");
  return ps;
}

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

export async function generatePost(form: FormData) {
  await run(async () => {
    const topic = String(form.get("topic") ?? "").trim();
    if (!topic) throw new Error("請輸入主題");
    const platforms = platformsFrom(form);
    let imageUrl: string | undefined;
    const file = form.get("image");
    if (file instanceof File && file.size > 0) {
      if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error("圖片請用 JPG 或 PNG");
      imageUrl = await uploadImage(await file.arrayBuffer(), file.type);
    }
    const rec = await createDraft({
      topic,
      platforms,
      withImage: form.get("withImage") === "on",
      webSearch: form.get("webSearch") === "on",
      imageUrl,
    });
    return `已產生草稿：「${rec.title}」，確認內容後可立即發布或排程`;
  });
}

export async function saveCaption(form: FormData) {
  await run(async () => {
    const id = String(form.get("id"));
    const rec = await getRecord<PostData>(id);
    const caption = String(form.get("caption") ?? "").trim();
    if (!caption) throw new Error("文案不能是空的");
    await updateRecord<PostData>(id, {
      title: String(form.get("title") ?? rec.title).trim() || rec.title,
      data: { ...rec.data, caption, platforms: platformsFrom(form) },
    });
    return "已儲存";
  });
}

export async function schedulePost(form: FormData) {
  await run(async () => {
    const id = String(form.get("id"));
    const iso = taipeiLocalToIso(String(form.get("publishAt") ?? ""));
    if (new Date(iso).getTime() < Date.now() - 60_000) throw new Error("排程時間已經過去了，請選未來的時間");
    await updateRecord(id, { status: "已排程", publishAt: iso });
    return "已排程，到點會自動發布（需設定好 cron）";
  });
}

export async function unschedulePost(form: FormData) {
  await run(async () => {
    await updateRecord(String(form.get("id")), { status: "草稿", publishAt: null });
    return "已取消排程，改回草稿";
  });
}

export async function publishNow(form: FormData) {
  await run(async () => {
    const rec = await publishRecord(String(form.get("id")));
    if (rec.status === "已發布") return "發布成功！";
    const errs = Object.entries(rec.data.results ?? {})
      .filter(([, r]) => r && !r.ok)
      .map(([p, r]) => `${p.toUpperCase()}: ${r!.error}`);
    throw new Error(`部分或全部發布失敗 — ${errs.join("；")}`);
  });
}

export async function deletePost(form: FormData) {
  await run(async () => {
    await archiveRecord(String(form.get("id")));
    return "已刪除（Notion 垃圾桶可還原）";
  });
}

export async function selectPage(form: FormData) {
  await run(async () => {
    const conn = await getConnection();
    if (!conn) throw new Error("尚未連接 Meta");
    const id = String(form.get("pageId"));
    if (!conn.pages.some((p) => p.id === id)) throw new Error("找不到這個粉專");
    await saveConnection({ ...conn, selectedPageId: id });
    return "已切換發布的粉專";
  });
}
