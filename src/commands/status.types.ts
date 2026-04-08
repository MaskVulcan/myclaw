import type { ChannelId } from "../channels/plugins/types.js";

export type SessionStatus = {
  agentId?: string;
  key: string;
  kind: "direct" | "group" | "global" | "unknown";
  sessionId?: string;
  updatedAt: number | null;
  age: number | null;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number | null;
  totalTokensFresh: boolean;
  cacheRead?: number;
  cacheWrite?: number;
  remainingTokens: number | null;
  percentUsed: number | null;
  model: string | null;
  contextTokens: number | null;
  flags: string[];
};

export type HeartbeatStatus = {
  agentId: string;
  enabled: boolean;
  every: string;
  everyMs: number | null;
};

export type StatusSessionOverview = {
  recentActivity: {
    last60m: number;
    last24h: number;
    last7d: number;
  };
  topModels: Array<{
    model: string;
    count: number;
  }>;
  topAgents: Array<{
    agentId: string;
    count: number;
  }>;
  kinds: Array<{
    kind: SessionStatus["kind"];
    count: number;
  }>;
};

export type StatusSummary = {
  runtimeVersion?: string | null;
  linkChannel?: {
    id: ChannelId;
    label: string;
    linked: boolean;
    authAgeMs: number | null;
  };
  heartbeat: {
    defaultAgentId: string;
    agents: HeartbeatStatus[];
  };
  channelSummary: string[];
  queuedSystemEvents: string[];
  tasks: {
    total: number;
    active: number;
    terminal: number;
    failures: number;
    byStatus: {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
      timed_out: number;
      cancelled: number;
      lost: number;
    };
    byRuntime: {
      subagent: number;
      acp: number;
      cli: number;
      cron: number;
    };
  };
  taskAudit: {
    total: number;
    warnings: number;
    errors: number;
    byCode: {
      stale_queued: number;
      stale_running: number;
      lost: number;
      delivery_failed: number;
      missing_cleanup: number;
      inconsistent_timestamps: number;
    };
  };
  sessions: {
    paths: string[];
    count: number;
    defaults: { model: string | null; contextTokens: number | null };
    overview: StatusSessionOverview;
    recent: SessionStatus[];
    byAgent: Array<{
      agentId: string;
      path: string;
      count: number;
      recent: SessionStatus[];
    }>;
  };
};
