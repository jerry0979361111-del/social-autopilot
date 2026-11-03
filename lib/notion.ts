import { env } from "./config";

// 一個 Notion 資料庫同時存三種東西，用保留標題區分：
//   一般貼文            標題 = 貼文標題
//   Meta 連線設定        標題 = META_TITLE
//   自動化任務           標題 = AUTOMATION_PREFIX + 任務名稱
// 欄位：標題(Title)、狀態(Select)、發布時間(Date)、資料JSON(Text)

export const META_TITLE = "[系統] Meta 連線設定";
export const AUTOMATION_PREFIX = "[自動化] ";

export const STATUSES = ["草稿", "已排程", "發布中", "已發布", "發布失敗"] as const;
export type Status = (typeof STATUSES)[number];

export type NotionRecord<T = unknown> = {
  id: string;
  title: string;
  status: Status | null;
  publishAt: string | null;
  data: T;
  createdTime: string;
  lastEditedTime: string;
};

const API = "https://api.notion.com/v1";

async function notion<T = any>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.notionKey()}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint =
      res.status === 404
        ? "（請確認已在資料庫頁面右上角 ⋯ → 連接 → 選取你的整合）"
        : res.status === 401
          ? "（NOTION_API_KEY 不正確）"
          : "";
    throw new Error(`Notion API 錯誤 ${res.status}: ${json.message ?? res.statusText}${hint}`);
  }
  return json as T;
}

function textChunks(s: string) {
  const chunks = [];
  for (let i = 0; i < s.length; i += 2000) chunks.push({ type: "text", text: { content: s.slice(i, i + 2000) } });
  if (chunks.length > 100) throw new Error("資料太大，無法存進 Notion（請縮短內容）");
  return chunks;
}

function props(fields: { title?: string; status?: Status; publishAt?: string | null; data?: unknown }) {
  const p: Record<string, unknown> = {};
  if (fields.title !== undefined) p["標題"] = { title: [{ type: "text", text: { content: fields.title.slice(0, 2000) } }] };
  if (fields.status !== undefined) p["狀態"] = { select: { name: fields.status } };
  if (fields.publishAt !== undefined) p["發布時間"] = { date: fields.publishAt ? { start: fields.publishAt } : null };
  if (fields.data !== undefined) p["資料JSON"] = { rich_text: textChunks(JSON.stringify(fields.data)) };
  return p;
}

function parsePage<T>(page: any): NotionRecord<T> {
  const p = page.properties ?? {};
  const title = (p["標題"]?.title ?? []).map((t: any) => t.plain_text).join("");
  const raw = (p["資料JSON"]?.rich_text ?? []).map((t: any) => t.plain_text).join("");
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  return {
    id: page.id,
    title,
    status: p["狀態"]?.select?.name ?? null,
    publishAt: p["發布時間"]?.date?.start ?? null,
    data,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
  };
}

export async function queryRecords<T>(filter?: unknown, sorts?: unknown, max = 100): Promise<NotionRecord<T>[]> {
  const out: NotionRecord<T>[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion(`/databases/${env.notionDb()}/query`, "POST", {
      filter,
      sorts,
      start_cursor: cursor,
      page_size: Math.min(100, max - out.length),
    });
    out.push(...res.results.map((r: any) => parsePage<T>(r)));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor && out.length < max);
  return out;
}

export async function getRecord<T>(id: string): Promise<NotionRecord<T>> {
  return parsePage<T>(await notion(`/pages/${id}`, "GET"));
}

export async function createRecord<T>(fields: {
  title: string;
  status: Status;
  publishAt?: string | null;
  data: T;
}): Promise<NotionRecord<T>> {
  const page = await notion("/pages", "POST", {
    parent: { database_id: env.notionDb() },
    properties: props(fields),
  });
  return parsePage<T>(page);
}

export async function updateRecord<T>(
  id: string,
  fields: { title?: string; status?: Status; publishAt?: string | null; data?: T },
): Promise<NotionRecord<T>> {
  return parsePage<T>(await notion(`/pages/${id}`, "PATCH", { properties: props(fields) }));
}

export async function archiveRecord(id: string): Promise<void> {
  await notion(`/pages/${id}`, "PATCH", { archived: true });
}

export const titleIsReserved = (title: string) => title === META_TITLE || title.startsWith(AUTOMATION_PREFIX);
