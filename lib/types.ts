export type Platform = "fb" | "ig";
export const PLATFORM_LABEL: Record<Platform, string> = { fb: "Facebook", ig: "Instagram" };

export type PublishResult = { ok: boolean; id?: string; error?: string; at: string };

export type PostData = {
  kind: "post";
  topic: string;
  platforms: Platform[];
  caption: string;
  imageUrl?: string;
  results?: Partial<Record<Platform, PublishResult>>;
  automationId?: string;
  /** 由 AI 社群經理產生 */
  origin?: "manager";
  pillar?: string;
  /** AI 社群經理排定的時段（ISO），避免同一時段重複產文 */
  managerSlot?: string;
  review?: ReviewResult;
  metrics?: Partial<Record<Platform, PostMetrics>>;
  photo?: PhotoInfo;
  /** IG 輪播：全部圖片（第一張即 imageUrl） */
  imageUrls?: string[];
  /** 給團隊參考的 Reels 腳本（不會自動發布） */
  reelsScript?: string;
  /** 簽證、稅務、法規類貼文：需經營者核准後才排程 */
  approval?: { status: "pending" | "approved" | "rejected"; slot?: string; reason: string; at: string };
  /** 由官方網站更新選題時的來源 */
  official?: { state: string; label: string; title: string; url: string };
  /** 由熱門新聞選題時的來源議題 */
  trend?: { title: string; source: string; date: string };
};

/** 配圖照片的來源（真實照片需要標示作者與授權時用） */
export type PhotoInfo = { source: "upload" | "library" | "pexels" | "wikimedia" | "ai"; id?: string; credit?: string; pageUrl?: string };

export type ReviewResult = { pass: boolean; score: number; issues: string[]; at: string };

export type PostMetrics = {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  fetchedAt: string;
};

export type Pillar = { name: string; description: string; weight: number };

export type ManagerLog = { at: string; ok: boolean; message: string; postId?: string };

export type Reference = { keywords: string[]; url: string; note: string };

/** 要監測的官方網站頁面：news＝公告列表（抓新文章），page＝規定頁面（比對內容變更） */
export type OfficialSource = { state: string; label: string; url: string; kind: "news" | "page" };

/** 單一平台（FB 或 IG）的經營計畫 */
export type ChannelPlan = {
  enabled: boolean;
  days: number[];
  times: string[];
  pillars: Pillar[];
  /** 給 AI 的長期補充指示 */
  notes: string;
  /** 最近一次成效分析得到的洞察，會餵給產文 */
  learnings: string;
};

export type ManagerData = {
  kind: "manager";
  enabled: boolean;
  /** FB、IG 分開經營 */
  channels?: Record<Platform, ChannelPlan>;
  /** 特定主題要參考的資料來源（例如 FIRB 判決） */
  references?: Reference[];
  /** 官方資料監測來源（州稅局等） */
  officialSources?: OfficialSource[];
  lastReportAt?: string;
  logs: ManagerLog[];
  // 舊版（FB、IG 同一套設定）的欄位，讀取時會轉成 channels
  platforms?: Platform[];
  days?: number[];
  times?: string[];
  pillars?: Pillar[];
  notes?: string;
  learnings?: string;
};

export type ReportData = {
  kind: "report";
  platform?: Platform;
  periodStart: string;
  periodEnd: string;
  summary: string;
  learnings: string;
  pillarStats: { pillar: string; posts: number; avgEngagement: number }[];
  topPosts: { title: string; pillar?: string; engagement: number }[];
  weightChanges: { pillar: string; from: number; to: number }[];
};

export type AutomationRun = { at: string; slot: string; ok: boolean; postId?: string; message: string };

export type AutomationData = {
  kind: "automation";
  name: string;
  theme: string;
  platforms: Platform[];
  withImage: boolean;
  webSearch: boolean;
  enabled: boolean;
  days: number[];
  times: string[];
  /** 最後一個「成功發出」的排程時刻（ISO），避免重複發文 */
  lastDoneSlot?: string;
  runs: AutomationRun[];
};

export type MetaPage = {
  id: string;
  name: string;
  token: string;
  igId?: string;
  igUsername?: string;
};

export type MetaConnection = {
  kind: "meta";
  pages: MetaPage[];
  selectedPageId?: string;
  connectedAt: string;
  userName?: string;
};
