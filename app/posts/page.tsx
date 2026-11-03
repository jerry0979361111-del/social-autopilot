import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { getConnection, selectedPage } from "@/lib/meta";
import { formatTaipei, isoToTaipeiLocal } from "@/lib/time";
import { PLATFORM_LABEL, type Platform } from "@/lib/types";
import { listPosts } from "@/lib/workflow";
import {
  deletePost,
  generatePost,
  publishNow,
  saveCaption,
  schedulePost,
  selectPage,
  unschedulePost,
} from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  let loadError: string | undefined;
  let conn = null;
  let posts: Awaited<ReturnType<typeof listPosts>> = [];
  try {
    [conn, posts] = await Promise.all([getConnection(), listPosts()]);
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }
  const page = selectedPage(conn);

  return (
    <>
      <h1>貼文</h1>
      <Alerts error={error ?? loadError} notice={notice} />

      <section className="card">
        <div className="row">
          <div className="grow">
            {page ? (
              <>
                <strong>已連接：{page.name}</strong>
                <div className="muted">
                  Instagram：{page.igId ? `@${page.igUsername ?? page.igId}` : "未綁定（無法發 IG）"} · 連接時間{" "}
                  {formatTaipei(conn?.connectedAt)}
                </div>
              </>
            ) : (
              <strong>尚未連接 Meta 帳號</strong>
            )}
          </div>
          <a className={`btn ${page ? "" : "primary"}`} href="/api/auth/meta/login">
            {page ? "重新連接 Meta" : "連接 Meta 帳號"}
          </a>
        </div>
        {conn && conn.pages.length > 1 && (
          <form action={selectPage} className="row" style={{ marginTop: 12 }}>
            <select name="pageId" defaultValue={page?.id} className="grow">
              {conn.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.igUsername ? `（IG @${p.igUsername}）` : ""}
                </option>
              ))}
            </select>
            <SubmitButton>切換粉專</SubmitButton>
          </form>
        )}
      </section>

      <section className="card">
        <h2>AI 生成貼文</h2>
        <form action={generatePost}>
          <label htmlFor="topic">主題</label>
          <input type="text" id="topic" name="topic" placeholder="例如：秋天保養肌膚的 3 個小技巧" required />
          <div style={{ marginTop: 8 }}>
            <label className="inline"><input type="checkbox" name="platforms" value="ig" defaultChecked /> Instagram</label>
            <label className="inline"><input type="checkbox" name="platforms" value="fb" defaultChecked /> Facebook</label>
            <label className="inline"><input type="checkbox" name="withImage" defaultChecked /> AI 生成配圖</label>
            <label className="inline"><input type="checkbox" name="webSearch" /> 上網搜尋最新資訊</label>
          </div>
          <label htmlFor="image">或上傳自己的圖片（選填，JPG/PNG，有上傳就不會 AI 產圖）</label>
          <input type="file" id="image" name="image" accept="image/jpeg,image/png" />
          <p>
            <SubmitButton className="primary" pendingText="AI 生成中，約 30～90 秒…">生成貼文</SubmitButton>
          </p>
        </form>
      </section>

      <h2>貼文列表</h2>
      {posts.length === 0 && !loadError && <p className="muted">還沒有貼文，先在上面生成一則吧。</p>}
      {posts.map((p) => {
        const d = p.data;
        const editable = p.status !== "已發布" && p.status !== "發布中";
        return (
          <article key={p.id} className="card post">
            {d.imageUrl ? <img src={d.imageUrl} alt="" /> : <div className="noimg">無圖片</div>}
            <div>
              <div className="row">
                <strong className="grow">{p.title}</strong>
                <span className={`badge s-${p.status}`}>{p.status}</span>
              </div>
              <div className="muted">
                {(d.platforms ?? []).map((x) => PLATFORM_LABEL[x]).join(" + ")} · 建立 {formatTaipei(p.createdTime)}
                {p.publishAt && ` · 發布時間 ${formatTaipei(p.publishAt)}`}
                {d.automationId && " · 自動化"}
              </div>
              {d.results && (
                <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                  {Object.entries(d.results).map(([k, r]) =>
                    r ? (
                      <li key={k} className={r.ok ? "ok" : "err"}>
                        {PLATFORM_LABEL[k as Platform]}：{r.ok ? `成功（${formatTaipei(r.at)}）` : r.error}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
              {editable ? (
                <details>
                  <summary>查看／編輯文案</summary>
                  <form action={saveCaption}>
                    <input type="hidden" name="id" value={p.id} />
                    <label>標題（內部管理用）</label>
                    <input type="text" name="title" defaultValue={p.title} />
                    <label>文案</label>
                    <textarea name="caption" defaultValue={d.caption} />
                    <div>
                      <label className="inline"><input type="checkbox" name="platforms" value="ig" defaultChecked={d.platforms?.includes("ig")} /> Instagram</label>
                      <label className="inline"><input type="checkbox" name="platforms" value="fb" defaultChecked={d.platforms?.includes("fb")} /> Facebook</label>
                    </div>
                    <SubmitButton>儲存</SubmitButton>
                  </form>
                </details>
              ) : (
                <details>
                  <summary>查看文案</summary>
                  <pre className="caption">{d.caption}</pre>
                </details>
              )}
              {editable && (
                <div className="actions">
                  <form action={publishNow}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="primary" pendingText="發布中…" confirm="確定要立即發布嗎？">
                      {p.status === "發布失敗" ? "重試發布" : "立即發布"}
                    </SubmitButton>
                  </form>
                  {p.status === "已排程" ? (
                    <form action={unschedulePost}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton>取消排程</SubmitButton>
                    </form>
                  ) : (
                    <form action={schedulePost} className="row">
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="datetime-local"
                        name="publishAt"
                        required
                        defaultValue={p.publishAt ? isoToTaipeiLocal(p.publishAt) : undefined}
                        style={{ width: "auto" }}
                      />
                      <SubmitButton>排程（台北時間）</SubmitButton>
                    </form>
                  )}
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="danger" confirm="確定刪除這則貼文？">刪除</SubmitButton>
                  </form>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </>
  );
}
