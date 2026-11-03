import { put } from "@vercel/blob";
import { brand, env } from "./config";
import type { Platform } from "./types";

async function openai(path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = json?.error?.message ?? res.statusText;
    const billing = /billing|quota|not active|insufficient/i.test(msg)
      ? "（這是 OpenAI 帳務問題：請到 platform.openai.com → Billing 確認已綁付款且有額度）"
      : "";
    throw new Error(`OpenAI 錯誤 ${res.status}: ${msg}${billing}`);
  }
  return json;
}

export type GeneratedText = { title: string; caption: string; imagePrompt: string };

export async function generateText(
  topic: string,
  platforms: Platform[],
  opts: { webSearch?: boolean } = {},
): Promise<GeneratedText> {
  const where = platforms.map((p) => (p === "ig" ? "Instagram" : "Facebook")).join(" 與 ");
  const instructions = [
    `你是「${brand.name}」的社群小編，負責撰寫要同時發到 ${where} 的貼文。`,
    `文案語氣：${brand.tone}。`,
    "使用繁體中文（台灣用語）。",
    "文案結構：吸睛開頭一句 → 2～4 段重點（可用條列或表情符號）→ 行動呼籲 → 換行後 5～10 個相關 hashtag。",
    "總長度控制在 150～400 字，不要使用 Markdown 語法（社群平台不會渲染）。",
    "不要捏造具體數字、價格或日期；若引用最新資訊，只寫你確定的事實。",
    "只輸出一個 JSON 物件，不要有其他文字，格式：",
    '{"title":"給內部管理用的短標題（20 字內）","caption":"完整貼文文案（含 hashtag）","imagePrompt":"給 AI 畫配圖用的英文描述，描述畫面內容，不要在圖中放文字"}',
  ].join("\n");

  const res = await openai("/responses", {
    model: env.textModel(),
    instructions,
    input: `貼文主題：${topic}`,
    ...(opts.webSearch ? { tools: [{ type: "web_search" }] } : {}),
  });

  const text: string = (res.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 回傳格式不正確，請再試一次");
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("AI 回傳格式不正確，請再試一次");
  }
  if (!parsed.caption) throw new Error("AI 沒有產生文案，請再試一次");
  return {
    title: String(parsed.title || topic).slice(0, 80),
    caption: String(parsed.caption),
    imagePrompt: String(parsed.imagePrompt || topic),
  };
}

/** 產生 1:1 配圖並上傳到 Vercel Blob，回傳公開網址（IG 需要能公開抓取的 JPEG）。 */
export async function generateImage(imagePrompt: string): Promise<string> {
  const prompt = [
    imagePrompt,
    `Visual style: ${brand.style}.`,
    `Color palette accents: ${brand.colorPrimary} and ${brand.colorSecondary}.`,
    brand.nameEn ? `Brand: ${brand.nameEn}.` : "",
    "Square social media image. No text, no letters, no logos, no watermarks.",
  ]
    .filter(Boolean)
    .join(" ");

  const res = await openai("/images/generations", {
    model: env.imageModel(),
    prompt,
    size: "1024x1024",
    quality: "medium",
    output_format: "jpeg",
    output_compression: 85,
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI 沒有回傳圖片");
  return uploadImage(Buffer.from(b64, "base64"), "image/jpeg");
}

export async function uploadImage(bytes: Buffer | ArrayBuffer, contentType: string): Promise<string> {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const name = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const blob = await put(name, Buffer.from(bytes as ArrayBuffer), { access: "public", contentType });
    return blob.url;
  } catch (e: any) {
    throw new Error(`圖片上傳失敗：${e?.message ?? e}（請確認 Vercel 專案已連接 Blob 儲存空間）`);
  }
}
