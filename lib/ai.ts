import { put } from "@vercel/blob";
import { getVercelOidcToken } from "@vercel/oidc";
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

// FB 與 IG 分開經營：受眾行為不同，文案寫法也不同
const CHANNEL_STYLE: Record<Platform, string[]> = {
  fb: [
    "這篇只發 Facebook。FB 上的讀者會花時間讀完整解讀、在留言區討論、分享給其他家人朋友。",
    "依主題選最合適的形式：新聞與市場分析、迷思破解、列點知識文（5～10 點）、二選一或情境討論、實用檢查清單。",
    "寫法：開頭兩行就點出新聞事件或讀者在意的問題（FB 只顯示前兩三行）→ 用「▍」當小標分 2～4 段解讀「這對留學家庭或台灣買家代表什麼、該怎麼準備」→ 區分已確認的事實、估算與觀點 → 結尾只問一個具體、容易回答的問題（例如「你會選 A 還是 B？為什麼？」）→ 最後一行寫「資料來源：媒體或機構名稱（日期）」。",
    "CTA 依目標選一個：邀請留言討論、分享給需要的家人，或有具體需求時私訊關鍵字（例如私訊「墨爾本」「留學置產」），不要每篇都要求私訊。",
    "長度 300～600 字，表情符號最多 3 個，hashtag 0～3 個。",
  ],
  ig: [
    "這篇只發 Instagram。IG 的人快速滑動、看圖為主，好內容會被收藏和轉傳。",
    "依主題選最合適的形式：列點文（預設，5～10 點）、二選一對比、迷思破解（迷思 vs 事實）、情境分析、知識測驗、趨勢重點整理。",
    "寫法：第一行是 20 字內、清楚具體的問題型標題（例如「孩子去墨爾本留學，買房該選哪裡？」），不要用籠統的介紹型標題 → 列點或短段落，每點 1～2 行 → 必要時註明資料來源與日期 → 只問一個容易回答的互動問題 → 一個 CTA（收藏、分享給正在準備留學的家長，或私訊關鍵字）。",
    "長度 120～250 字，可適度使用表情符號。最後換行放「至少 10 個、最多 15 個」與本篇主題相關的 hashtag，中英混合，固定包含 #澳洲美家，其餘依主題挑選（例如留學主題用 #澳洲留學 #學生簽證 #留學生家長 #墨爾本留學 #StudyInAustralia；買房主題才用 #澳洲買房）。",
    "熱門新聞或政策主題，文末（hashtag 前）要有一行「資料來源：媒體或機構名稱（日期）」。",
  ],
};

/**
 * 社群平台不會渲染 Markdown：去掉網路搜尋自動加上的引用連結「([網域](網址))」、粗體與標題符號，
 * 只留下純文字（網址本身仍可保留在「資料來源」那一行）。
 */
export function plainCaption(text: string): string {
  return text
    .replace(/\s*\(\[([^\]]+)\]\((https?:[^)]+)\)\)/g, "") // ([ato.gov.au](https://...))
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1") // [文字](網址) → 文字
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type GeneratedText = { title: string; caption: string };

export async function generateText(
  topic: string,
  platforms: Platform[],
  opts: { webSearch?: boolean; channel?: Platform } = {},
): Promise<GeneratedText> {
  const where = platforms.map((p) => (p === "ig" ? "Instagram" : "Facebook")).join(" 與 ");
  const instructions = [
    `你是「${brand.name}」的社群小編，負責撰寫要同時發到 ${where} 的貼文。`,
    brand.about ? `品牌背景：${brand.about}` : "",
    brand.audience ? `目標受眾：${brand.audience}。文案要從他們的角度出發，回應他們真正在意的問題。` : "",
    `文案語氣：${brand.tone}。`,
    brand.website ? `行動呼籲可引導讀者私訊或前往官網 ${brand.website}。` : "",
    "使用繁體中文（台灣用語）。",
    ...(opts.channel ? CHANNEL_STYLE[opts.channel] : [
      "文案結構：吸睛開頭一句 → 2～4 段重點（可用條列或表情符號）→ 行動呼籲 → 換行後 5～10 個相關 hashtag。",
      "總長度控制在 150～400 字。",
    ]),
    "不要使用 Markdown 語法（社群平台不會渲染）。",
    "不要捏造具體數字、價格或日期；若引用最新資訊，只寫你確定的事實。",
    "涉及投資、租金或報酬時，不得保證獲利或使用誇大字眼，只能用「可評估」「供參考」等中性說法。",
    "只輸出一個 JSON 物件，不要有其他文字，格式：",
    '{"title":"給內部管理用的短標題（20 字內）","caption":"完整貼文文案（含 hashtag）"}',
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
    caption: plainCaption(String(parsed.caption)),
  };
}

/** 依畫面描述產生一張直式實景照片（不含任何文字），回傳原始圖檔。 */
export async function generatePhoto(scene: string): Promise<Buffer> {
  const prompt = [
    "Professional real estate and architectural photograph taken on location in Australia, magazine quality.",
    "Full-frame camera, wide-angle lens with corrected verticals, natural light, true-to-life colours, crisp detail, realistic materials.",
    "Looks like a real photo from a property listing or a travel feature, not an illustration, not a 3D render, not CGI.",
    `Scene: ${scene}`,
    `Mood and colour grading: ${brand.style}.`,
    "Vertical portrait composition, keep the lower third calm (sky, lawn, water or plain facade) because a headline will be placed there.",
    "No text, no letters, no signage text, no logos, no watermarks.",
  ].join(" ");
  return env.imageProvider() === "gateway" ? gatewayImage(prompt) : openaiImage(prompt);
}

// 依序嘗試；帳號沒有權限或模型已下架時，OpenAI 會回「does not exist」
const OPENAI_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];

async function openaiImage(prompt: string): Promise<Buffer> {
  const models = [...new Set([process.env.OPENAI_IMAGE_MODEL, ...OPENAI_IMAGE_MODELS].filter(Boolean) as string[])];
  const missing: string[] = [];
  for (const model of models) {
    try {
      const res = await openai("/images/generations", {
        model,
        prompt,
        size: "1024x1536",
        quality: process.env.OPENAI_IMAGE_QUALITY || "high",
        output_format: "jpeg",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI 沒有回傳圖片");
      return Buffer.from(b64, "base64");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/does not exist|model_not_found|404/i.test(msg)) throw e;
      missing.push(model);
    }
  }
  throw new Error(
    `OpenAI 帳號目前無法使用任何圖片模型（試過 ${missing.join("、")}）。剛完成組織驗證的話請等 15～30 分鐘；仍不行請建立新的 API Key 換到 Vercel`,
  );
}

/** 透過 Vercel AI Gateway 產圖：用部署本身的 OIDC 身分驗證，不需要另外的 API Key。 */
async function gatewayImage(prompt: string): Promise<Buffer> {
  let token = process.env.AI_GATEWAY_API_KEY;
  if (!token) {
    try {
      token = await getVercelOidcToken();
    } catch {
      throw new Error("無法取得 Vercel AI Gateway 授權（OIDC），請確認網站部署在 Vercel 上");
    }
  }
  const res = await fetch("https://ai-gateway.vercel.sh/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.gatewayImageModel(),
      prompt,
      n: 1,
      response_format: "b64_json",
      providerOptions: { blackForestLabs: { outputFormat: "jpeg" } },
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = json?.error?.message ?? json?.message ?? res.statusText;
    const hint = /credit|balance|billing|payment|quota/i.test(msg)
      ? "（Vercel AI Gateway 額度不足：到 Vercel → AI Gateway 查看或加值）"
      : "";
    throw new Error(`AI Gateway 產圖錯誤 ${res.status}: ${msg}${hint}`);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("AI Gateway 沒有回傳圖片");
  return Buffer.from(b64, "base64");
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

export async function askJson<T>(instructions: string, input: string): Promise<T> {
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
/**
 * 去掉 hashtag 與資料來源行後，數正文裡有幾項「具體資訊」：
 * 一個完整日期算一項（單獨的年份不算）、帶單位的數字算一項（金額、百分比、期間、距離等）。
 * 簽證類別編號、單獨的年份這類不能說明「變了什麼」的數字不算。
 */
export function concreteFacts(caption: string): number {
  let body = caption
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && !/資料來源/.test(l))
    .join("\n");
  const facts = new Set<string>();
  const take = (re: RegExp) => {
    body = body.replace(re, (m) => {
      facts.add(m.replace(/\s+/g, ""));
      return " ";
    });
  };
  take(/(\d{4}\s*年\s*)?\d{1,2}\s*月(\s*\d{1,2}\s*日)?|\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/g); // 日期
  take(/A\$\s?\d[\d,.]*\s*(萬|億)?|\d[\d,.]*\s*(%|％|萬|億|元|澳幣|澳元|台幣|歲|個月|週|天|小時|分鐘|公里|公尺|平方米|房|套|間)/g); // 帶單位的數字
  return facts.size;
}

export type ReviewContext = {
  /** 熱門新聞、官方更新等時事題材：一定要有具體內容與近期來源 */
  news?: boolean;
  /** 題材的發布日期（YYYY-MM-DD） */
  sourceDate?: string;
};

export async function reviewCaption(caption: string, recentTitles: string[], ctx: ReviewContext = {}): Promise<Review> {
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
    "6. 內容是否空泛：只說「規定有變化」「家長需注意」「建議關注官方公告」，卻沒寫出到底變了什麼、對誰、從何時開始、該怎麼做，就算空泛",
    ctx.news
      ? "7. 這是時事題材，標準更嚴：正文必須寫出至少兩項具體資訊（金額、百分比、日期、適用對象、具體規定內容），標題提到的數字（例如「上漲 25%」）正文一定要寫出並說明；只有趨勢描述或泛泛建議就算空泛。結尾要有「資料來源：媒體或機構（日期）」。"
      : "",
    "評分要嚴格：90 分以上＝具體、有用、可以直接發；80～89＝小瑕疵；80 分以下＝不能發。",
    "score 為 0～100 分；有任何第 2、3、6、7 點問題就不能通過；分數低於 80 也不通過。修正版不可為了湊內容而捏造細節：查不到的具體內容就刪掉該段，改寫成較短但具體的文案；若連一項具體資訊都寫不出來，revisedCaption 留空。",
    "若不通過，請在 revisedCaption 提供修正後可直接發布的完整文案（保留原本主題與 hashtag 風格）。",
    '只輸出 JSON：{"pass":true/false,"score":0-100,"issues":["問題1"],"revisedCaption":"..."}',
  ]
    .filter(Boolean)
    .join("\n");
  const input = `近期貼文標題：\n${recentTitles.slice(0, 20).map((t) => `- ${t}`).join("\n") || "（無）"}\n\n待審文案：\n${caption}`;
  const r = await askJson<Review>(instructions, input);
  const issues = Array.isArray(r.issues) ? r.issues.map(String) : [];
  if (hard) issues.unshift(`含有禁用字眼「${hard[0]}」`);
  // 不靠 AI 自評、用程式確認的硬性規則（只對時事題材）
  let ruleFail = false;
  if (ctx.news) {
    if (concreteFacts(caption) < 2) {
      issues.unshift("時事貼文缺少具體數字或日期（至少要 2 項）");
      ruleFail = true;
    }
    if (!/資料來源/.test(caption)) {
      issues.unshift("時事貼文缺少資料來源");
      ruleFail = true;
    }
    if (ctx.sourceDate) {
      const age = Date.now() - new Date(ctx.sourceDate).getTime();
      if (Number.isFinite(age) && age > 21 * 24 * 3600_000) {
        issues.unshift(`題材來源日期 ${ctx.sourceDate} 已超過 3 週，不算近期熱門`);
        ruleFail = true;
      }
    }
  }
  return {
    pass: Boolean(r.pass) && !hard && !ruleFail && Number(r.score) >= 80,
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

export type TrendTopic = {
  title: string;
  summary: string;
  source: string;
  date: string;
  /** 為什麼最近大家在討論 */
  why: string;
  /** 建議切入角度 */
  angle: string;
};

/**
 * 選題研究：上網搜尋近兩週澳洲房市、留學、簽證的新聞與討論，依熱門程度排序。
 * 已經寫過的主題交給呼叫端排除。
 */
export async function researchTrends(channel: Platform, covered: string[]): Promise<TrendTopic[]> {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const instructions = [
    `你是「${brand.name}」的社群選題研究員。今天是 ${today}（台北時間）。`,
    brand.audience ? `受眾：${brand.audience}` : "",
    "請用網路搜尋，找出「最近 14 天內」與以下領域相關、討論度最高的新聞與話題：",
    "澳洲房市（房價、租金、供給、利率、外國買家與 FIRB 規定）、澳洲留學（學生簽證、留學生人數上限、學費、學生住宿）、簽證與移民政策（畢業工作簽、技術移民）。",
    "以墨爾本為優先，其次是全澳洲；可參考澳洲主流媒體、政府公告、房地產研究機構，以及台灣媒體與家長社群的相關報導。",
    "依「熱門程度」排序：多家媒體報導、社群大量討論、政策剛公布或即將生效的排前面。",
    "只列真的在最近 14 天內發生或被大量討論的事，不要編造；日期與來源要具體。",
    "只選你在搜尋結果中查得到「具體內容」（改了什麼、適用對象、生效日期、數字）的議題；只看得到標題、查不到細節的不要列。summary 要寫出這些具體內容。",
    `${channel === "fb" ? "這是給 Facebook 的選題，偏好適合深入解讀與留言討論的新聞。" : "這是給 Instagram 的選題，偏好能整理成清單、比較或一圖看懂的話題。"}`,
    "以下是我們最近已經做過的主題，請排除相同或高度相似的題目：",
    covered.slice(0, 40).map((t) => `- ${t}`).join("\n") || "（無）",
    "列出 6～8 個，只輸出 JSON：",
    '{"topics":[{"title":"議題標題","summary":"一兩句重點","source":"媒體或機構名稱","date":"YYYY-MM-DD","why":"為什麼最近熱門","angle":"給台灣留學生家長或買家的切入角度"}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const res = await openai("/responses", {
    model: env.textModel(),
    instructions,
    input: "請開始搜尋並整理。",
    tools: [{ type: "web_search" }],
  });
  const text: string = (res.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const topics = JSON.parse(match[0]).topics;
    return Array.isArray(topics)
      ? topics
          .filter((t: any) => t?.title)
          .map((t: any) => ({
            title: String(t.title),
            summary: String(t.summary ?? ""),
            source: String(t.source ?? ""),
            date: String(t.date ?? ""),
            why: String(t.why ?? ""),
            angle: String(t.angle ?? ""),
          }))
      : [];
  } catch {
    return [];
  }
}

/** 兩段中文標題是否在講同一件事（字元二元組重疊率），用來避免重複選題 */
export function similarTopic(a: string, b: string): boolean {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const g = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    return g;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.45;
}

/** Reels 短影片腳本（給團隊參考，不會自動發布） */
export async function generateReelsScript(title: string, caption: string): Promise<string> {
  const instructions = [
    `你是「${brand.name}」的短影音企劃。依據這篇 IG 貼文，寫一支 30～45 秒的 Reels 拍攝腳本，讓團隊可以直接照著拍。`,
    "格式（純文字、繁體中文）：",
    "【開場 0–3 秒】一句問題、反差或關鍵結論（畫面＋口白＋字幕）",
    "【分鏡】4～6 段，每段寫：秒數、畫面（建議拍什麼：建案現場、街景、看房、白板說明等）、口白、字幕",
    "【結尾】只放一個行動呼籲（留言、分享或私訊關鍵字）",
    "【拍攝建議】2～3 點（場地、運鏡、需要的素材）",
    "不得捏造數字、客戶或成交；涉及法規時提醒以官方最新資訊為準。",
  ].join("\n");
  const res = await openai("/responses", { model: env.textModel(), instructions, input: `標題：${title}\n\n貼文：\n${caption}` });
  return (res.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("")
    .trim();
}
