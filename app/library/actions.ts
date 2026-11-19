"use server";

import { revalidatePath } from "next/cache";
import { addUpload, importFromDrive, importFromWebsite, removePhoto } from "@/lib/library";
import { back } from "@/lib/redirect";

const PATH = "/library";

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

export async function importWebsite() {
  await run(importFromWebsite);
}

export async function importDrive(form: FormData) {
  await run(() => importFromDrive(String(form.get("links") ?? "")));
}

export async function upload(form: FormData) {
  await run(async () => {
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("請選擇照片");
    const note = String(form.get("description") ?? "").trim();
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error(`${f.name} 不是 JPG／PNG／WebP`);
      await addUpload(Buffer.from(await f.arrayBuffer()), note || f.name.replace(/\.\w+$/, ""), note);
    }
    return `已加入 ${files.length} 張照片`;
  });
}

export async function remove(form: FormData) {
  await run(async () => {
    await removePhoto(String(form.get("id")));
    return "已從照片庫移除";
  });
}
