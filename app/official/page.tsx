import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { getManager } from "@/lib/manager";
import { listSnapshots, OFFICE_NAME } from "@/lib/official";
import { formatTaipei } from "@/lib/time";
import type { OfficialSource } from "@/lib/types";
import { backfill, checkNow, saveSources } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function OfficialPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  let loadError: string | undefined;
  let sources: OfficialSource[] = [];
  let snaps: Awaited<ReturnType<typeof listSnapshots>> = [];
  try {
    [sources, snaps] = await Promise.all([getManager().then((m) => m.officialSources ?? []), listSnapshots()]);
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }
  const updates = snaps
    .flatMap((s) => (s.data.updates ?? []).map((u) => ({ s: s.data, u })))
    .sort((a, b) => b.u.at.localeCompare(a.u.at))
    .slice(0, 20);

  return (
    <>
      <h1>官方資料</h1>
      <Alerts error={error ?? loadError} notice={notice} />
      <p className="muted">
        系統每天讀取一次以下州稅局頁面：規定頁面會被整理成「已學習重點」，產文時遇到相關主題（例如墨爾本海外買家印花稅）就當作查證依據；
        公告頁出現新文章、或規定頁面有實質變更時，會成為 AI 社群經理最優先的發文題材（每則只寫一次）。
      </p>

      <section className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>最新官方更新</h2>
          <div className="actions" style={{ marginTop: 0 }}>
            <form action={backfill}>
              <SubmitButton pendingText="挑選並整理近期公告中…">近 30 天相關公告標成待發</SubmitButton>
            </form>
            <form action={checkNow}>
              <SubmitButton pendingText="讀取並分析官方網站中…（最多約 4 分鐘）">立即檢查全部</SubmitButton>
            </form>
          </div>
        </div>
        {updates.length === 0 ? (
          <p className="muted">還沒有偵測到新公告。第一次檢查只會建立基準與學習內容，之後有新公告或規定變更才會出現在這裡。</p>
        ) : (
          <table>
            <thead>
              <tr><th>偵測時間</th><th>來源</th><th>更新內容</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {updates.map(({ s, u }, i) => (
                <tr key={i}>
                  <td>{formatTaipei(u.at)}</td>
                  <td>{s.state} {s.label}</td>
                  <td>
                    <a href={u.url} target="_blank" rel="noreferrer"><strong>{u.title}</strong></a>
                    <div className="muted">{u.summary}</div>
                  </td>
                  <td className={u.usedAt ? "ok" : ""}>{u.usedAt ? `已寫成貼文（${formatTaipei(u.usedAt)}）` : "待發"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>監測來源與已學習重點</h2>
        <table>
          <thead>
            <tr><th>來源</th><th>最後檢查</th><th>重點</th></tr>
          </thead>
          <tbody>
            {sources.map((src) => {
              const s = snaps.find((x) => x.data.url === src.url)?.data;
              return (
                <tr key={src.url}>
                  <td style={{ width: 200 }}>
                    <a href={src.url} target="_blank" rel="noreferrer">{OFFICE_NAME[src.state] ?? src.state}</a>
                    <div>{src.label}{src.kind === "news" ? "（公告列表）" : ""}</div>
                  </td>
                  <td style={{ width: 130 }} className={s?.error ? "err" : ""}>
                    {s?.checkedAt ? formatTaipei(s.checkedAt) : "尚未檢查"}
                    {s?.error && <div>{s.error}</div>}
                  </td>
                  <td>
                    {s?.summary ? (
                      <details>
                        <summary>查看</summary>
                        <pre className="caption">{s.summary}</pre>
                      </details>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>編輯監測來源</h2>
        <form action={saveSources}>
          <label>每行一個：州｜名稱｜網址｜news（公告列表）或 page（規定頁面）</label>
          <textarea
            name="sources"
            style={{ minHeight: 260, fontSize: "0.85rem" }}
            defaultValue={sources.map((s) => `${s.state}｜${s.label}｜${s.url}｜${s.kind}`).join("\n")}
          />
          <p><SubmitButton>儲存</SubmitButton></p>
        </form>
      </section>
    </>
  );
}
