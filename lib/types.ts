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
};

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

export type ManagerData = {
  kind: "manager";
  enabled: boolean;
  platforms: Platform[];
  days: number[];
  times: string[];
  pillars: Pillar[];
  /** 給 AI 的長期補充指示 */
  notes: string;
  /** 最近一次成效分析得到的洞察，會餵給產文 */
  learnings: string;
  lastReportAt?: string;
  logs: ManagerLog[];
};

export type ReportData = {
  kind: "report";
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
