import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { CHANNEL_LABEL, channelsOf, getManager, getManagerRecord, listReports, openSlots } from "@/lib/manager";
import type { NotionRecord } from "@/lib/notion";
import { formatTaipei, WEEKDAYS } from "@/lib/time";
import type { ChannelPlan, ManagerData, Platform, ReportData } from "@/lib/types";
import { listPosts } from "@/lib/workflow";
import { fillNow, reportNow, saveSettings } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PLATFORMS: Platform[] = ["fb", "ig"];

function ChannelFields({ p, plan }: { p: Platform; plan: ChannelPlan }) {
  return (
    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <legend><strong>{CHANNEL_LABEL[p]}</strong></legend>
      <label className="inline"><input type="checkbox" name={`${p}_enabled`} defaultChecked={plan.enabled} /> 經營 {CHANNEL_LABEL[p]}</label>
      <label>發文星期</label>
      <div>
        {WEEKDAYS.map((w, i) => (
          <label key={i} className="inline">
            <input type="checkbox" name={`${p}_days`} value={i} defaultChecked={plan.days.includes(i)} /> 週{w}
          </label>
        ))}
      </div>
      <label>發文時間（台北時間，可填多個，逗號分隔）</label>
      <input type="text" name={`${p}_times`} defaultValue={plan.times.join(", ")} />
      <label>常青內容支柱（熱門新聞都做過時才用；每行：名稱｜說明｜比重 0.3～2）</label>
      <textarea
        name={`${p}_pillars`}
        style={{ minHeight: 140 }}
        defaultValue={plan.pillars.map((x) => `${x.name}｜${x.description}｜${x.weight}`).join("\n")}
      />
      <label>給 AI 的補充指示（選填）</label>
      <textarea name={`${p}_notes`} style={{ minHeight: 70 }} defaultValue={plan.notes} />
      <input type="hidden" name={`${p}_learnings`} value={plan.learnings} />
      {plan.learnings && (
        <>
          <label>目前採用的成效洞察（每週報告自動更新）</label>
          <pre className="caption muted">{plan.learnings}</pre>
        </>
      )}
    </fieldset>
  );
}

function Report({ r }: { r: ReportData }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: "1rem", margin: "8px 0" }}>
        {r.platform ? CHANNEL_LABEL[r.platform] : "FB + IG"}
        <span className="muted">{formatTaipei(r.periodStart)} ～ {formatTaipei(r.periodEnd)}</span>
      </h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{r.summary}</p>
      <p className="muted">下週方向</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{r.learnings}</p>
      <table>
        <thead>
          <tr><th>內容支柱</th><th>則數</th><th>平均互動</th></tr>
        </thead>
        <tbody>
          {r.pillarStats.map((s) => (
            <tr key={s.pillar}><td>{s.pillar}</td><td>{s.posts}</td><td>{s.avgEngagement}</td></tr>
          ))}
        </tbody>
      </table>
      {r.weightChanges.length > 0 && (
        <p className="muted">比重調整：{r.weightChanges.map((w) => `${w.pillar} ${w.from}→${w.to}`).join("、")}</p>
      )}
    </div>
  );
}

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
    m = await getManager();
    posts = ps;
    reports = rs;
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }
  const channels = m ? channelsOf(m) : null;

  const queue = posts
    .filter((p) => p.data.origin === "manager" && (p.status === "已排程" || p.status === "草稿"))
    .sort((a, b) => (a.publishAt ?? "").localeCompare(b.publishAt ?? ""));
  // 每個平台最新一份報告
  const latest = PLATFORMS.map((p) => reports.find((r) => (r.data.platform ?? p) === p)?.data).filter(
    (r, i, arr): r is ReportData => Boolean(r) && arr.indexOf(r) === i,
  );

  return (
    <>
      <h1>AI 社群經理</h1>
      <Alerts error={error ?? loadError} notice={notice} />
      <p className="muted">
        FB 與 IG 分開經營。每次產文前，AI 會先上網搜尋近兩週澳洲房市、留學、簽證的新聞與討論，挑最熱門且還沒做過的議題；
        都做過了才改用常青內容支柱。文案通過審稿後，再依文案找真實照片做圖，排進行事曆自動發布。每週分析一次成效並調整方向。
      </p>

      {m && channels && (
        <section className="card">
          <div className="row">
            <h2 className="grow" style={{ margin: 0 }}>狀態</h2>
            <span className={`badge ${m.enabled ? "ok" : "muted"}`}>{m.enabled ? "運作中" : saved ? "已停用" : "尚未啟用"}</span>
          </div>
          {PLATFORMS.map((p) => (
            <p key={p} className="muted" style={{ margin: "4px 0" }}>
              {CHANNEL_LABEL[p]}：
              {channels[p].enabled
                ? `每週${channels[p].days.map((d) => WEEKDAYS[d]).join("、")} ${channels[p].times.join("、")} · 未來 7 天還有 ${openSlots(p, channels[p], posts).length} 個空時段`
                : "不經營"}
            </p>
          ))}
          <p className="muted" style={{ margin: "4px 0" }}>上次成效分析 {formatTaipei(m.lastReportAt)}</p>
          <div className="actions">
            <form action={fillNow}>
              <SubmitButton pendingText="搜尋熱門議題、產文、審稿、找照片中…（約 2～3 分鐘）">立即補一則</SubmitButton>
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
              <tr><th>預定時間</th><th>平台</th><th>主題</th><th>選題來源</th><th>審稿</th></tr>
            </thead>
            <tbody>
              {queue.map((p) => (
                <tr key={p.id}>
                  <td>{formatTaipei(p.publishAt)}</td>
                  <td>{p.data.platforms.map((x) => CHANNEL_LABEL[x]).join("、")}</td>
                  <td>{p.title}</td>
                  <td>{p.data.trend ? `熱門：${p.data.trend.title}（${p.data.trend.source}）` : p.data.pillar}</td>
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
        {latest.length ? (
          <>
            {latest.map((r, i) => <Report key={i} r={r} />)}
            <p className="muted">互動分數 = 讚 + 留言×2 + 分享×3 + 收藏×3</p>
          </>
        ) : (
          <p className="muted">還沒有報告。啟用後每 7 天自動產生一次，也可以按「立即產生成效報告」。</p>
        )}
      </section>

      {m && channels && (
        <section className="card">
          <h2>設定</h2>
          <form action={saveSettings}>
            <label className="inline"><input type="checkbox" name="enabled" defaultChecked={m.enabled} /> 啟用 AI 社群經理（全自動發布）</label>
            {PLATFORMS.map((p) => <ChannelFields key={p} p={p} plan={channels[p]} />)}
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
