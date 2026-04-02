import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agents/pi-embedded.runtime.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));

vi.mock("../../config/sessions/group.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../config/sessions/paths.js", () => ({
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));

vi.mock("../../routing/session-key.js", () => ({
  normalizeMainKey: vi.fn().mockReturnValue("main"),
  normalizeAgentId: vi.fn((id?: string) => id ?? "main"),
  parseAgentSessionKey: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../utils/provider-utils.js", () => ({
  isReasoningTagProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("../command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));

vi.mock("./agent-runner.runtime.js", () => ({
  runReplyAgent: vi.fn().mockResolvedValue({ text: "ok" }),
}));

vi.mock("./body.js", () => ({
  applySessionHints: vi.fn().mockImplementation(async ({ baseBody }) => baseBody),
}));

vi.mock("./groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
}));

vi.mock("./queue/settings.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.runtime.js", () => ({
  routeReply: vi.fn(),
}));

vi.mock("./session-updates.runtime.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
}));

vi.mock("./session-system-events.js", () => ({
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./typing-mode.js", () => ({
  resolveTypingMode: vi.fn().mockReturnValue("off"),
}));

vi.mock("./weixin-recall.js", () => ({
  buildWeixinTranscriptRecall: vi
    .fn()
    .mockReturnValue(
      'Source: same Weixin DM transcript recall\nRelevant older same-chat snippets (untrusted):\n```json\n[{"messages":[{"role":"assistant","text":"旧端口是 19090"}]}]\n```',
    ),
}));

let runPreparedReply: typeof import("./get-reply-run.js").runPreparedReply;
let runReplyAgent: typeof import("./agent-runner.runtime.js").runReplyAgent;

async function loadFreshModuleForTest() {
  vi.resetModules();
  ({ runReplyAgent } = await import("./agent-runner.runtime.js"));
  ({ runPreparedReply } = await import("./get-reply-run.js"));
}

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: "API 端口现在是多少",
      RawBody: "API 端口现在是多少",
      CommandBody: "API 端口现在是多少",
      OriginatingChannel: "openclaw-weixin",
      OriginatingTo: "wx-user-1",
      ChatType: "direct",
    },
    sessionCtx: {
      Body: "API 端口现在是多少",
      BodyStripped: "API 端口现在是多少",
      Provider: "openclaw-weixin",
      OriginatingChannel: "openclaw-weixin",
      OriginatingTo: "wx-user-1",
      ChatType: "direct",
      UntrustedContext: ["Source: channel metadata\nchannel=openclaw-weixin"],
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } },
    agentId: "main",
    agentDir: "/tmp/agent",
    agentCfg: {},
    sessionCfg: {},
    commandAuthorized: true,
    command: {
      surface: "openclaw-weixin",
      channel: "openclaw-weixin",
      isAuthorizedSender: true,
      abortKey: "session-key",
      ownerList: [],
      senderIsOwner: false,
      rawBodyNormalized: "API 端口现在是多少",
      commandBodyNormalized: "API 端口现在是多少",
    } as never,
    allowTextCommands: true,
    directives: {
      hasThinkDirective: false,
      thinkLevel: undefined,
    } as never,
    defaultActivation: "always",
    resolvedThinkLevel: "high",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: {
      resolveDefaultThinkingLevel: async () => "medium",
    } as never,
    provider: "anthropic",
    model: "claude-opus-4-1",
    typing: {
      onReplyStart: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    } as never,
    defaultProvider: "anthropic",
    defaultModel: "claude-opus-4-1",
    timeoutMs: 30_000,
    isNewSession: false,
    resetTriggered: false,
    systemSent: true,
    sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
    sessionId: "sess-weixin",
    storePath: "/tmp/sessions.json",
    sessionEntry: {
      sessionId: "sess-weixin",
      sessionFile: "/tmp/session.jsonl",
      updatedAt: Date.now(),
    },
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    ...overrides,
  };
}

describe("runPreparedReply Weixin recall injection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadFreshModuleForTest();
  });

  it("prepends the Weixin recall block into untrusted context", async () => {
    const result = await runPreparedReply(baseParams());
    expect(result).toEqual({ text: "ok" });

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.commandBody).toContain("same Weixin DM transcript recall");
    expect(call?.commandBody).toContain("旧端口是 19090");
    expect(call?.commandBody).toContain("channel=openclaw-weixin");

    const recallIndex = call?.commandBody.indexOf("same Weixin DM transcript recall") ?? -1;
    const metadataIndex = call?.commandBody.indexOf("channel=openclaw-weixin") ?? -1;
    expect(recallIndex).toBeGreaterThan(-1);
    expect(metadataIndex).toBeGreaterThan(-1);
    expect(recallIndex).toBeLessThan(metadataIndex);
  });
});
