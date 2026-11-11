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
    brand.about ? `品牌背景：${brand.about}` : "",
    brand.audience ? `目標受眾：${brand.audience}。文案要從他們的角度出發，回應他們真正在意的問題。` : "",
    `文案語氣：${brand.tone}。`,
    brand.website ? `行動呼籲可引導讀者私訊或前往官網 ${brand.website}。` : "",
    "使用繁體中文（台灣用語）。",
    "文案結構：吸睛開頭一句 → 2～4 段重點（可用條列或表情符號）→ 行動呼籲 → 換行後 5～10 個相關 hashtag。",
    "總長度控制在 150～400 字，不要使用 Markdown 語法（社群平台不會渲染）。",
    "不要捏造具體數字、價格或日期；若引用最新資訊，只寫你確定的事實。",
    "涉及投資、租金或報酬時，不得保證獲利或使用誇大字眼，只能用「可評估」「供參考」等中性說法。",
    "只輸出一個 JSON 物件，不要有其他文字，格式：",
    '{"title":"給內部管理用的短標題（20 字內）","caption":"完整貼文文案（含 hashtag）","imagePrompt":"給 AI 畫配圖用的英文描述，描述畫面內容，不要在圖中放文字"}',
  ]
    .filter(Boolean)
    .join("\n");

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

async function askJson<T>(instructions: string, input: string): Promise<T> {
  const res = await openai("/responses", { model: env.textModel(), instructions, input });
  const text: string = (res.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 回傳格式不正確");
  return JSON.parse(match[0]) as T;
}

// 不需要問 AI 就能確定違規的字眼（房產、投資內容的常見誇大用語）
const BANNED = /保證(獲利|賺|回報|收益|增值|出租)|穩賺|零風險|無風險|包租|翻倍|穩定獲利|必漲|只漲不跌/;

export type Review = { pass: boolean; score: number; issues: string[]; revisedCaption?: string };

/** 發布前把關：品牌語氣、合規用語、重複度。不合格時附上修正版文案。 */
export async function reviewCaption(caption: string, recentTitles: string[]): Promise<Review> {
  const hard = caption.match(BANNED);
  const instructions = [
    `你是「${brand.name}」的社群內容審稿主編，負責在貼文自動發布前把關。`,
    brand.about ? `品牌背景：${brand.about}` : "",
    brand.audience ? `目標受眾：${brand.audience}` : "",
    `品牌語氣：${brand.tone}`,
    "請逐項檢查：",
    "1. 是否符合品牌語氣，對目標受眾有幫助、不推銷過頭",
    "2. 是否有保證獲利、誇大、絕對化或可能誤導的投資／房產用語",
    "3. 是否捏造具體數字、價格、日期、政策或統計（無法確定的具體數據都算）",
    "4. 是否與近期貼文主題過於重複",
    "5. 是否為繁體中文（台灣用語）、無 Markdown、長度與 hashtag 適當",
    "score 為 0～100 分；有任何第 2、3 點問題就不能通過；分數低於 75 也不通過。",
    "若不通過，請在 revisedCaption 提供修正後可直接發布的完整文案（保留原本主題與 hashtag 風格）。",
    '只輸出 JSON：{"pass":true/false,"score":0-100,"issues":["問題1"],"revisedCaption":"..."}',
  ]
    .filter(Boolean)
    .join("\n");
  const input = `近期貼文標題：\n${recentTitles.slice(0, 20).map((t) => `- ${t}`).join("\n") || "（無）"}\n\n待審文案：\n${caption}`;
  const r = await askJson<Review>(instructions, input);
  const issues = Array.isArray(r.issues) ? r.issues.map(String) : [];
  if (hard) issues.unshift(`含有禁用字眼「${hard[0]}」`);
  return {
    pass: Boolean(r.pass) && !hard && Number(r.score) >= 75,
    score: Number(r.score) || 0,
    issues,
    revisedCaption: r.revisedCaption ? String(r.revisedCaption) : undefined,
  };
}

export type Analysis = { summary: string; learnings: string; weights: Record<string, number> };

/** 依近期貼文成效，產出洞察與各內容支柱的新權重。 */
export async function analyzePerformance(
  rows: { title: string; pillar?: string; engagement: number; reach?: number; publishedAt: string }[],
  pillars: { name: string; weight: number }[],
): Promise<Analysis> {
  const instructions = [
    `你是「${brand.name}」的社群行銷分析師。`,
    brand.audience ? `目標受眾：${brand.audience}` : "",
    "根據近期貼文的互動數據，找出受眾反應好與不好的主題、角度與切入點。",
    "樣本少時要保守，不要過度推論。",
    "weights：為每個內容支柱給新權重（0.3～2.0，原權重附在輸入中），表現好的調高、差的調低，每次調整幅度不超過 ±0.4。",
    "learnings：給下週產文用的 3～5 條具體建議（繁體中文，條列，每條一行）。",
    "summary：給老闆看的 3～5 句成效摘要（繁體中文）。",
    '只輸出 JSON：{"summary":"...","learnings":"...","weights":{"支柱名稱":1.2}}',
  ]
    .filter(Boolean)
    .join("\n");
  const input = JSON.stringify({ pillars, posts: rows });
  const r = await askJson<Analysis>(instructions, input);
  return { summary: String(r.summary ?? ""), learnings: String(r.learnings ?? ""), weights: r.weights ?? {} };
}
