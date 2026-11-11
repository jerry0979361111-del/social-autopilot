import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { getManager, getManagerRecord, listReports, openSlots } from "@/lib/manager";
import { formatTaipei, WEEKDAYS } from "@/lib/time";
import type { ManagerData, ReportData } from "@/lib/types";
import type { NotionRecord } from "@/lib/notion";
import { listPosts } from "@/lib/workflow";
import { fillNow, reportNow, saveSettings } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  let loadError: string | undefined;
  let m: ManagerData | null = null;
  let saved = false;
  let posts: Awaited<ReturnType<typeof listPosts>> = [];
  let reports: NotionRecord<ReportData>[] = [];
  try {
    const [rec, ps, rs] = await Promise.all([getManagerRecord(), listPosts(), listReports()]);
    saved = Boolean(rec);
    m = rec?.data ?? (await getManager());
    posts = ps;
    reports = rs;
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }

  const queue = posts
    .filter((p) => p.data.origin === "manager" && (p.status === "已排程" || p.status === "草稿"))
    .sort((a, b) => (a.data.managerSlot ?? "").localeCompare(b.data.managerSlot ?? ""));
  const open = m ? openSlots(m, posts) : [];
  const latest = reports[0]?.data;

  return (
    <>
      <h1>AI 社群經理</h1>
      <Alerts error={error ?? loadError} notice={notice} />
      <p className="muted">
        AI 會依內容支柱自動企劃、產文產圖，發布前由 AI 審稿把關（品牌語氣、誇大或保證獲利用語、捏造數據、主題重複），
        通過就排進行事曆並自動發布；沒通過會留在草稿並寫明原因。每週分析一次 FB／IG 成效，自動調整各主題的比重。
      </p>

      {m && (
        <section className="card">
          <div className="row">
            <h2 className="grow" style={{ margin: 0 }}>狀態</h2>
            <span className={`badge ${m.enabled ? "ok" : "muted"}`}>{m.enabled ? "運作中" : saved ? "已停用" : "尚未啟用"}</span>
          </div>
          <p className="muted">
            每週{m.days.map((d) => WEEKDAYS[d]).join("、")} {m.times.join("、")} 發文 · 未來 7 天還有 {open.length} 個空時段 · 上次成效分析{" "}
            {formatTaipei(m.lastReportAt)}
          </p>
          <div className="actions">
            <form action={fillNow}>
              <SubmitButton pendingText="AI 企劃、產文、審稿中…（約 1～2 分鐘）">立即補一則</SubmitButton>
            </form>
            <form action={reportNow}>
              <SubmitButton pendingText="抓取數據並分析中…">立即產生成效報告</SubmitButton>
            </form>
          </div>
        </section>
      )}

      <section className="card">
        <h2>接下來的貼文</h2>
        {queue.length === 0 ? (
          <p className="muted">目前沒有。啟用後，cron 每次會補一則，或按「立即補一則」。</p>
        ) : (
          <table>
            <thead>
              <tr><th>預定時間</th><th>主題</th><th>支柱</th><th>審稿</th></tr>
            </thead>
            <tbody>
              {queue.map((p) => (
                <tr key={p.id}>
                  <td>{formatTaipei(p.publishAt ?? p.data.managerSlot)}</td>
                  <td>{p.title}</td>
                  <td>{p.data.pillar}</td>
                  <td className={p.data.review?.pass ? "ok" : "err"}>
                    {p.data.review?.pass ? `通過 ${p.data.review.score} 分` : `未通過：${p.data.review?.issues.join("；")}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">要修改或取消某一則，到 <Link href="/posts">貼文</Link> 頁操作。</p>
      </section>

      <section className="card">
        <h2>最新成效報告</h2>
        {latest ? (
          <>
            <p className="muted">
              {formatTaipei(latest.periodStart)} ～ {formatTaipei(latest.periodEnd)}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{latest.summary}</p>
            <h3 style={{ fontSize: "1rem" }}>下週產文方向</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{latest.learnings}</p>
            <table>
              <thead>
                <tr><th>內容支柱</th><th>則數</th><th>平均互動</th></tr>
              </thead>
              <tbody>
                {latest.pillarStats.map((s) => (
                  <tr key={s.pillar}><td>{s.pillar}</td><td>{s.posts}</td><td>{s.avgEngagement}</td></tr>
                ))}
              </tbody>
            </table>
            {latest.weightChanges.length > 0 && (
              <p className="muted">
                比重調整：{latest.weightChanges.map((w) => `${w.pillar} ${w.from}→${w.to}`).join("、")}
              </p>
            )}
            <p className="muted">互動分數 = 讚 + 留言×2 + 分享×3 + 收藏×3（FB、IG 合計）</p>
          </>
        ) : (
          <p className="muted">還沒有報告。啟用後每 7 天自動產生一次，也可以按「立即產生成效報告」。</p>
        )}
      </section>

      {m && (
        <section className="card">
          <h2>設定</h2>
          <form action={saveSettings}>
            <label className="inline"><input type="checkbox" name="enabled" defaultChecked={m.enabled} /> 啟用 AI 社群經理（全自動發布）</label>
            <label>發文星期</label>
            <div>
              {WEEKDAYS.map((w, i) => (
                <label key={i} className="inline">
                  <input type="checkbox" name="days" value={i} defaultChecked={m!.days.includes(i)} /> 週{w}
                </label>
              ))}
            </div>
            <label>發文時間（台北時間，可填多個，逗號分隔）</label>
            <input type="text" name="times" defaultValue={m.times.join(", ")} />
            <div style={{ marginTop: 8 }}>
              <label className="inline"><input type="checkbox" name="platforms" value="ig" defaultChecked={m.platforms.includes("ig")} /> Instagram</label>
              <label className="inline"><input type="checkbox" name="platforms" value="fb" defaultChecked={m.platforms.includes("fb")} /> Facebook</label>
            </div>
            <label>內容支柱（每行一個：名稱｜說明｜比重 0.3～2，比重越高越常出現；每週會依成效自動微調）</label>
            <textarea
              name="pillars"
              style={{ minHeight: 180 }}
              defaultValue={m.pillars.map((p) => `${p.name}｜${p.description}｜${p.weight}`).join("\n")}
            />
            <label>給 AI 的補充指示（選填，例如：近期主打 Carlton 區、避免提到某某議題）</label>
            <textarea name="notes" style={{ minHeight: 80 }} defaultValue={m.notes} />
            {m.learnings && (
              <>
                <label>目前採用的成效洞察（由每週報告自動更新）</label>
                <pre className="caption muted">{m.learnings}</pre>
              </>
            )}
            <p><SubmitButton className="primary">儲存設定</SubmitButton></p>
          </form>
        </section>
      )}

      {m && m.logs.length > 0 && (
        <section className="card">
          <h2>工作紀錄</h2>
          <table>
            <tbody>
              {m.logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ width: 150 }}>{formatTaipei(l.at)}</td>
                  <td className={l.ok ? "" : "err"}>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
