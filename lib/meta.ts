import { env, GRAPH_VERSION } from "./config";
import { createRecord, META_TITLE, queryRecords, updateRecord, type NotionRecord } from "./notion";
import type { MetaConnection, MetaPage, Platform, PostData, PublishResult } from "./types";

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
];

export const redirectUri = () => `${env.baseUrl()}/api/auth/meta/callback`;

export function loginUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env.metaAppId(),
    redirect_uri: redirectUri(),
    state,
    scope: META_SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<any> {
  const q = new URLSearchParams(params);
  const url = method === "GET" ? `${GRAPH}${path}?${q}` : `${GRAPH}${path}`;
  const res = await fetch(url, {
    method,
    body: method === "POST" ? q : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    let hint = "";
    if (e.code === 190) hint = "（授權已失效，請回 /posts 重新「連接 Meta 帳號」）";
    else if (/log in to www\.facebook\.com/i.test(e.message ?? ""))
      hint = "（請用管理粉專的帳號登入 facebook.com 處理安全檢查提示，系統會自動重試）";
    else if (e.code === 200 || e.code === 10)
      hint = "（權限不足：確認此 FB 帳號已加入 App 角色，且授權時有勾選所有權限）";
    throw new Error(`Meta 錯誤 ${e.code ?? res.status}: ${e.error_user_msg || e.message || res.statusText}${hint}`);
  }
  return json;
}

// ---------- 連線設定（存在 Notion 的保留頁） ----------

export async function getConnectionRecord(): Promise<NotionRecord<MetaConnection> | null> {
  const rows = await queryRecords<MetaConnection>({ property: "標題", title: { equals: META_TITLE } }, undefined, 1);
  return rows[0] ?? null;
}

export async function getConnection(): Promise<MetaConnection | null> {
  const rec = await getConnectionRecord();
  return rec && rec.data?.kind === "meta" ? rec.data : null;
}

export function selectedPage(conn: MetaConnection | null): MetaPage | null {
  if (!conn || conn.pages.length === 0) return null;
  return conn.pages.find((p) => p.id === conn.selectedPageId) ?? conn.pages[0];
}

export async function saveConnection(conn: MetaConnection): Promise<void> {
  const rec = await getConnectionRecord();
  if (rec) await updateRecord(rec.id, { data: conn, status: "草稿" });
  else await createRecord({ title: META_TITLE, status: "草稿", data: conn });
}

export async function completeLogin(code: string): Promise<MetaConnection> {
  const short = await graph("/oauth/access_token", {
    client_id: env.metaAppId(),
    client_secret: env.metaAppSecret(),
    redirect_uri: redirectUri(),
    code,
  });
  const long = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.metaAppId(),
    client_secret: env.metaAppSecret(),
    fb_exchange_token: short.access_token,
  });
  const userToken: string = long.access_token;
  const me = await graph("/me", { fields: "name", access_token: userToken });
  const accounts = await graph("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: userToken,
  });
  const pages: MetaPage[] = (accounts.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    igId: p.instagram_business_account?.id,
    igUsername: p.instagram_business_account?.username,
  }));
  if (pages.length === 0)
    throw new Error("找不到你管理的粉專。請確認授權時有勾選粉專，且此 FB 帳號是粉專管理員。");

  const prev = await getConnection();
  const keep = prev?.selectedPageId && pages.some((p) => p.id === prev.selectedPageId);
  const conn: MetaConnection = {
    kind: "meta",
    pages,
    selectedPageId: keep ? prev!.selectedPageId : pages[0].id,
    connectedAt: new Date().toISOString(),
    userName: me.name,
  };
  await saveConnection(conn);
  return conn;
}

// ---------- 發布 ----------

async function publishFacebook(page: MetaPage, caption: string, imageUrl?: string): Promise<string> {
  if (imageUrl) {
    const r = await graph(`/${page.id}/photos`, { url: imageUrl, caption, access_token: page.token }, "POST");
    return r.post_id ?? r.id;
  }
  const r = await graph(`/${page.id}/feed`, { message: caption, access_token: page.token }, "POST");
  return r.id;
}

async function publishInstagram(page: MetaPage, caption: string, imageUrl?: string): Promise<string> {
  if (!page.igId)
    throw new Error("這個粉專沒有綁定 Instagram 商業／創作者帳號（請在 IG 設定中把帳號切成專業帳號並連結此粉專，再重新連接 Meta）");
  if (!imageUrl) throw new Error("Instagram 貼文一定要有圖片");
  const container = await graph(
    `/${page.igId}/media`,
    { image_url: imageUrl, caption, access_token: page.token },
    "POST",
  );
  // 等 IG 處理完圖片再發布
  for (let i = 0; i < 20; i++) {
    const s = await graph(`/${container.id}`, { fields: "status_code", access_token: page.token });
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
      throw new Error(`Instagram 處理圖片失敗（${s.status_code}），請確認圖片網址可公開存取`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const r = await graph(
    `/${page.igId}/media_publish`,
    { creation_id: container.id, access_token: page.token },
    "POST",
  );
  return r.id;
}

/** 發到指定平台；每個平台獨立成功或失敗。 */
export async function publishToPlatforms(
  post: Pick<PostData, "caption" | "imageUrl" | "platforms">,
  only?: Platform[],
): Promise<Partial<Record<Platform, PublishResult>>> {
  const page = selectedPage(await getConnection());
  const targets = only ?? post.platforms;
  const results: Partial<Record<Platform, PublishResult>> = {};
  for (const p of targets) {
    const at = new Date().toISOString();
    try {
      if (!page) throw new Error("尚未連接 Meta 帳號，請到 /posts 按「連接 Meta 帳號」");
      const id =
        p === "fb"
          ? await publishFacebook(page, post.caption, post.imageUrl)
          : await publishInstagram(page, post.caption, post.imageUrl);
      results[p] = { ok: true, id, at };
    } catch (e: any) {
      results[p] = { ok: false, error: String(e?.message ?? e), at };
    }
  }
  return results;
}
