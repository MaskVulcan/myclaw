import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../channels/config-presence.js", () => ({
  hasPotentialConfiguredChannels: vi.fn(() => true),
}));

vi.mock("./status.summary.runtime.js", () => ({
  statusSummaryRuntime: {
    classifySessionKey: vi.fn(() => "direct"),
    resolveConfiguredStatusModelRef: vi.fn(() => ({
      provider: "openai",
      model: "gpt-5.2",
    })),
    resolveSessionModelRef: vi.fn(() => ({
      provider: "openai",
      model: "gpt-5.2",
    })),
    resolveContextTokensForModel: vi.fn(() => 200_000),
  },
}));

vi.mock("../agents/defaults.js", () => ({
  DEFAULT_CONTEXT_TOKENS: 200_000,
  DEFAULT_MODEL: "gpt-5.2",
  DEFAULT_PROVIDER: "openai",
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../config/sessions/main-session.js", () => ({
  resolveMainSessionKey: vi.fn(() => "main"),
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
}));

vi.mock("../config/sessions/store-read.js", () => ({
  readSessionStoreReadOnly: vi.fn(() => ({
    "+1000": {
      updatedAt: Date.now() - 60_000,
      totalTokens: 5_000,
      totalTokensFresh: true,
      contextTokens: 10_000,
      model: "gpt-5.2",
      sessionId: "abc123",
    },
    "discord:group:dev": {
      updatedAt: Date.now() - 3 * 60 * 60_000,
      model: "gpt-5.2",
      sessionId: "group123",
    },
  })),
}));

vi.mock("../config/sessions/types.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions/types.js")>();
  return {
    ...actual,
    resolveFreshSessionTotalTokens: vi.fn(
      (entry?: { totalTokens?: number; totalTokensFresh?: boolean }) =>
        typeof entry?.totalTokens === "number" && entry?.totalTokensFresh !== false
          ? entry.totalTokens
          : undefined,
    ),
  };
});

vi.mock("../gateway/agent-list.js", () => ({
  listGatewayAgentsBasic: vi.fn(() => ({
    defaultId: "main",
    agents: [{ id: "main" }],
  })),
}));

vi.mock("../infra/channel-summary.js", () => ({
  buildChannelSummary: vi.fn(async () => ["ok"]),
}));

vi.mock("../infra/heartbeat-summary.js", () => ({
  resolveHeartbeatSummaryForAgent: vi.fn(() => ({
    enabled: true,
    every: "5m",
    everyMs: 300_000,
  })),
}));

vi.mock("../infra/system-events.js", () => ({
  peekSystemEvents: vi.fn(() => []),
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: vi.fn((value: string) => value),
  normalizeMainKey: vi.fn((value?: string) => value ?? "main"),
  parseAgentSessionKey: vi.fn(() => null),
}));

vi.mock("../version.js", () => ({
  resolveRuntimeServiceVersion: vi.fn(() => "2026.3.8"),
}));

vi.mock("./status.link-channel.js", () => ({
  resolveLinkChannelContext: vi.fn(async () => undefined),
}));

const { hasPotentialConfiguredChannels } = await import("../channels/config-presence.js");
const { buildChannelSummary } = await import("../infra/channel-summary.js");
const { resolveLinkChannelContext } = await import("./status.link-channel.js");
const { statusSummaryRuntime } = await import("./status.summary.runtime.js");
const { getStatusSummary } = await import("./status.summary.js");

describe("getStatusSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes runtimeVersion in the status payload", async () => {
    const summary = await getStatusSummary();

    expect(summary.runtimeVersion).toBe("2026.3.8");
    expect(summary.heartbeat.defaultAgentId).toBe("main");
    expect(summary.channelSummary).toEqual(["ok"]);
  });

  it("skips channel summary imports when no channels are configured", async () => {
    vi.mocked(hasPotentialConfiguredChannels).mockReturnValue(false);

    const summary = await getStatusSummary();

    expect(summary.channelSummary).toEqual([]);
    expect(summary.linkChannel).toBeUndefined();
    expect(buildChannelSummary).not.toHaveBeenCalled();
    expect(resolveLinkChannelContext).not.toHaveBeenCalled();
  });

  it("does not trigger async context warmup while building status summaries", async () => {
    await getStatusSummary();

    expect(vi.mocked(statusSummaryRuntime.resolveContextTokensForModel)).toHaveBeenCalledWith(
      expect.objectContaining({ allowAsyncLoad: false }),
    );
  });

  it("includes session overview counts in the status payload", async () => {
    const summary = await getStatusSummary();

    expect(summary.sessions.count).toBe(2);
    expect(summary.sessions.overview.recentActivity).toEqual({
      last60m: 1,
      last24h: 2,
      last7d: 2,
    });
    expect(summary.sessions.overview.topModels).toEqual([{ model: "gpt-5.2", count: 2 }]);
    expect(summary.sessions.overview.topAgents).toEqual([{ agentId: "main", count: 2 }]);
    expect(summary.sessions.overview.kinds).toEqual([{ kind: "direct", count: 2 }]);
  });
});
