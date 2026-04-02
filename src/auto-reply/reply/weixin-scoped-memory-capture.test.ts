import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFollowupRun } from "./test-helpers.js";

const enqueueFollowupRunMock = vi.fn();
const runWithModelFallbackMock = vi.fn();
const runEmbeddedPiAgentMock = vi.fn();

let buildWeixinScopedMemoryCapturePrompt: typeof import("./weixin-scoped-memory-capture.js").buildWeixinScopedMemoryCapturePrompt;
let maybeEnqueueWeixinScopedMemoryCapture: typeof import("./weixin-scoped-memory-capture.js").maybeEnqueueWeixinScopedMemoryCapture;
let resolveWeixinScopedMemoryCaptureCandidate: typeof import("./weixin-scoped-memory-capture.js").resolveWeixinScopedMemoryCaptureCandidate;
let runWeixinScopedMemoryCaptureTurn: typeof import("./weixin-scoped-memory-capture.js").runWeixinScopedMemoryCaptureTurn;
let scoreWeixinScopedMemoryCapture: typeof import("./weixin-scoped-memory-capture.js").scoreWeixinScopedMemoryCapture;

async function loadFreshModuleForTest() {
  vi.resetModules();
  vi.doMock("../../agents/model-fallback.js", async () => {
    const actual = await vi.importActual<typeof import("../../agents/model-fallback.js")>(
      "../../agents/model-fallback.js",
    );
    return {
      ...actual,
      runWithModelFallback: (...args: unknown[]) => runWithModelFallbackMock(...args),
    };
  });
  vi.doMock("../../agents/pi-embedded.js", async () => {
    const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
      "../../agents/pi-embedded.js",
    );
    return {
      ...actual,
      runEmbeddedPiAgent: (...args: unknown[]) => runEmbeddedPiAgentMock(...args),
    };
  });
  vi.doMock("./queue.js", async () => {
    const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
    return {
      ...actual,
      enqueueFollowupRun: (...args: unknown[]) => enqueueFollowupRunMock(...args),
    };
  });
  ({
    buildWeixinScopedMemoryCapturePrompt,
    maybeEnqueueWeixinScopedMemoryCapture,
    resolveWeixinScopedMemoryCaptureCandidate,
    runWeixinScopedMemoryCaptureTurn,
    scoreWeixinScopedMemoryCapture,
  } = await import("./weixin-scoped-memory-capture.js"));
}

function createWeixinSessionContext(overrides: Record<string, unknown> = {}) {
  return {
    Body: "记住：以后默认直接答，少废话，按我指定格式严格输出。",
    BodyStripped: "记住：以后默认直接答，少废话，按我指定格式严格输出。",
    ReplyToBody: "之前你问我要不要记住默认工作方式。",
    Provider: "openclaw-weixin",
    OriginatingChannel: "openclaw-weixin",
    OriginatingTo: "wx-user-1",
    ChatType: "direct",
    ...overrides,
  } as never;
}

describe("weixin scoped memory capture", () => {
  beforeEach(async () => {
    enqueueFollowupRunMock.mockReset();
    runEmbeddedPiAgentMock.mockReset();
    runWithModelFallbackMock.mockReset();
    runWithModelFallbackMock.mockImplementation(
      async (params: {
        provider?: string;
        model?: string;
        run: (provider: string, model: string, opts?: unknown) => Promise<unknown>;
      }) => ({
        provider: params.provider ?? "anthropic",
        model: params.model ?? "claude",
        result: await params.run(params.provider ?? "anthropic", params.model ?? "claude", {}),
      }),
    );
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "NO_REPLY" }],
      meta: { agentMeta: { sessionId: "wx-memory-test" } },
    });
    await loadFreshModuleForTest();
  });

  it("scores durable preference turns above the capture threshold", () => {
    expect(
      scoreWeixinScopedMemoryCapture({
        userText: "记住：以后默认直接答，少废话，严格按我指定格式回复。",
        assistantText: "我会记住，后续默认按这个来。",
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("builds a scoped capture candidate for Weixin direct messages", () => {
    const followupRun = createMockFollowupRun({
      messageId: "msg-1",
      run: {
        agentId: "main",
        sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        messageProvider: "openclaw-weixin",
        config: {
          agents: {
            defaults: {
              userTimezone: "Asia/Shanghai",
            },
          },
        },
        timeoutMs: 90_000,
      },
    });

    const candidate = resolveWeixinScopedMemoryCaptureCandidate({
      followupRun,
      sessionCtx: createWeixinSessionContext(),
      payloads: [{ text: "我会记住，以后默认按这个来。" }],
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.score).toBeGreaterThanOrEqual(2);
    expect(candidate?.targetRelativePath).toBe(".openclaw/weixin-dm-memory/primary/wx-user-1.md");
    expect(candidate?.followupRun.prompt).toContain(
      "Target file: .openclaw/weixin-dm-memory/primary/wx-user-1.md",
    );
    expect(candidate?.followupRun.prompt).toContain("Current user message:");
    expect(candidate?.followupRun.run.sessionKey).toBe(
      "agent:main:openclaw-weixin:primary:direct:wx-user-1:thread:0",
    );
    expect(candidate?.followupRun.run.extraSystemPrompt).toContain(
      "Do not write DM-specific notes into shared MEMORY.md.",
    );
    expect(candidate?.followupRun.run.thinkLevel).toBe("off");
  });

  it("does not create a candidate outside Weixin direct messages", () => {
    const followupRun = createMockFollowupRun({
      run: {
        sessionKey: "agent:main:slack:direct:u123",
        messageProvider: "slack",
      },
    });

    const candidate = resolveWeixinScopedMemoryCaptureCandidate({
      followupRun,
      sessionCtx: createWeixinSessionContext({
        Provider: "slack",
        OriginatingChannel: "slack",
      }),
      payloads: [{ text: "我会记住。" }],
    });

    expect(candidate).toBeNull();
  });

  it("enqueues the background capture turn when a candidate exists", () => {
    enqueueFollowupRunMock.mockReturnValue(true);
    const followupRun = createMockFollowupRun({
      messageId: "msg-1",
      run: {
        agentId: "main",
        sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        messageProvider: "openclaw-weixin",
      },
    });

    const enqueued = maybeEnqueueWeixinScopedMemoryCapture({
      followupRun,
      sessionCtx: createWeixinSessionContext(),
      payloads: [{ text: "记住了，以后按这个来。" }],
    });

    expect(enqueued).toBe(true);
    expect(enqueueFollowupRunMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "weixin-memory:agent:main:openclaw-weixin:primary:direct:wx-user-1:thread:0",
      ),
      expect.objectContaining({
        prompt: expect.stringContaining("Review the just-finished Weixin direct-message turn"),
      }),
      expect.objectContaining({
        mode: "queue",
        cap: 1,
      }),
      "prompt",
      expect.any(Function),
    );
  });

  it("runs the silent capture turn and cleans up the side-session transcript", async () => {
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), "wx-memory-capture-"));
    const sessionFile = path.join(tempDir, "wx-memory-test.jsonl");
    await fs.writeFile(sessionFile, '{"message":{"role":"user","content":"test"}}\n', "utf8");

    const followupRun = createMockFollowupRun({
      prompt: buildWeixinScopedMemoryCapturePrompt({
        cfg: {},
        targetRelativePath: ".openclaw/weixin-dm-memory/primary/wx-user-1.md",
        userText: "记住：以后默认直接答。",
        assistantText: "我会记住。",
      }),
      run: {
        agentId: "main",
        sessionId: "wx-memory-test",
        sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1:thread:0",
        sessionFile,
        workspaceDir: tempDir,
        messageProvider: "openclaw-weixin",
        provider: "anthropic",
        model: "claude",
        timeoutMs: 10_000,
        thinkLevel: "off",
        verboseLevel: "off",
        reasoningLevel: "off",
      },
    });

    await runWeixinScopedMemoryCaptureTurn(followupRun);

    expect(runEmbeddedPiAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "memory",
        sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1:thread:0",
        sessionFile,
        thinkLevel: "off",
        prompt: expect.stringContaining("Current user message:"),
      }),
    );
    await expect(fs.access(sessionFile)).rejects.toThrow();
  });
});
