# 社群自動發文工具（IG / FB Autopilot）

輸入主題 → AI 生成貼文文案與配圖 → 立即發布或排程 → 到點自動發到 Facebook 粉專與 Instagram。
也可以設定「每週固定時段」的自動化任務，系統自己產文、產圖、發文。

## 架構

| 元件 | 用途 |
|---|---|
| Next.js（部署在 Vercel） | 網站介面與 API |
| Notion 資料庫 | 存貼文、Meta 連線設定、自動化任務 |
| Vercel Blob | 存配圖（IG 需要可公開抓取的圖片網址） |
| OpenAI | 文案（`gpt-4.1-mini`，可上網搜尋）與配圖（`gpt-image-1`） |
| Meta Graph API | 發布到 FB 粉專與 IG 專業帳號 |
| cron-job.org | 每 30 分鐘呼叫 `/api/cron/publish`，觸發排程發布 |

## 頁面

- `/posts`：連接 Meta、AI 生成貼文、編輯、立即發布、排程
- `/automations`：每週固定時段的自動發文任務與執行紀錄
- `/setup`：檢查環境變數、Notion 欄位、Blob、Meta 連線是否就緒

## 部署步驟

1. **Notion**：建立 Internal 整合拿到 `NOTION_API_KEY`；建立資料庫，欄位名稱要一字不差：
   - `標題`（Title）、`狀態`（Select：草稿、已排程、發布中、已發布、發布失敗）、`發布時間`（Date）、`資料JSON`（Text）
   - 資料庫右上角 ⋯ → 連接 → 選你的整合
2. **OpenAI**：建立 API key，並確認 Billing 已綁付款。
3. **Meta**：developers.facebook.com 建立 Business 類型 App → 加入「Facebook 登入」→
   有效的 OAuth 重新導向 URI 填 `<網址>/api/auth/meta/callback` → 在「應用程式角色」把要發文的 FB 帳號加進去（開發模式免送審）。
   IG 必須是商業／創作者帳號並綁定粉專。
4. **Vercel**：Import 這個 repo → Storage 建立 Blob 並連接專案 → 填入 `.env.example` 裡的環境變數 → Redeploy。
5. 打開 `/setup` 確認全部打勾 → `/posts` 按「連接 Meta 帳號」→ 生成一則並「立即發布」測試。
6. **cron-job.org**：每 30 分鐘呼叫 `<網址>/api/cron/publish?secret=<CRON_SECRET>`。
   （`vercel.json` 另外設了 Vercel 內建每日一次的備援排程，免費方案只能一天一次。）

## 行為說明

- 時間一律為台北時間（UTC+8）。
- 已成功的平台不會重發；重試只補發失敗的平台。
- 自動化任務某次全部失敗，下一輪 cron 會在 24 小時內自動重試；任一平台成功即視為完成，不重複發文。
- 卡在「發布中」超過 15 分鐘的貼文會被標成「發布失敗」，可手動重試。
- Page token 失效時（例如改了 FB 密碼），回 `/posts` 重新連接 Meta 即可。

## 本機開發

```bash
npm install
cp .env.example .env.local   # 填入你的值
npm run dev
```
