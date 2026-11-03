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
