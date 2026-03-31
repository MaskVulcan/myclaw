import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const maybeHandleVirtualForegroundTaskMessageMock = vi.fn();
const runEmbeddedPiAgentMock = vi.fn();
const runCliAgentMock = vi.fn();
const runWithModelFallbackMock = vi.fn();

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: (params: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => runWithModelFallbackMock(params),
  isFallbackSummaryError: () => false,
}));

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
  };
});

vi.mock("../../agents/cli-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/cli-runner.js")>(
    "../../agents/cli-runner.js",
  );
  return {
    ...actual,
    runCliAgent: (params: unknown) => runCliAgentMock(params),
  };
});

vi.mock("./task-aware-routing.js", () => ({
  maybeHandleVirtualForegroundTaskMessage: (params: unknown) =>
    maybeHandleVirtualForegroundTaskMessageMock(params),
}));

import { runReplyAgent } from "./agent-runner.js";

beforeEach(() => {
  maybeHandleVirtualForegroundTaskMessageMock.mockReset();
  maybeHandleVirtualForegroundTaskMessageMock.mockResolvedValue(null);
  runEmbeddedPiAgentMock.mockReset();
  runCliAgentMock.mockReset();
  runWithModelFallbackMock.mockReset();
  runWithModelFallbackMock.mockImplementation(
    async ({
      provider,
      model,
      run,
    }: {
      provider: string;
      model: string;
      run: (provider: string, model: string) => Promise<unknown>;
    }) => ({
      result: await run(provider, model),
      provider,
      model,
    }),
  );
});

describe("runReplyAgent task-aware short-circuit", () => {
  it("returns the task-aware reply without invoking model execution", async () => {
    maybeHandleVirtualForegroundTaskMessageMock.mockResolvedValueOnce({
      text: "已转给 Codex 持续处理：继续优化",
    });
    const typing = createMockTypingController();
    const sessionCtx = {
      Provider: "weixin",
      OriginatingTo: "wx:chat:1",
      AccountId: "primary",
      MessageSid: "msg",
      Surface: "weixin",
    } as unknown as TemplateContext;
    const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
    const followupRun = {
      prompt: "hello",
      summaryLine: "hello",
      enqueuedAt: Date.now(),
      run: {
        sessionId: "session",
        sessionKey: "main",
        messageProvider: "weixin",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        config: {},
        skillsSnapshot: {},
        provider: "codex-vip",
        model: "gpt-5.2",
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: {
          enabled: false,
          allowed: false,
          defaultLevel: "off",
        },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun;

    const result = await runReplyAgent({
      commandBody: "任务：继续优化",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      defaultModel: "codex-vip/gpt-5.2",
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(result).toMatchObject({
      text: "已转给 Codex 持续处理：继续优化",
    });
    expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    expect(runCliAgentMock).not.toHaveBeenCalled();
  });
});
