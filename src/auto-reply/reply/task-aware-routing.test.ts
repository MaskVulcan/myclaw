import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { loadSessionStore, saveSessionStore } from "../../config/sessions.js";
import { emitAgentEvent, resetAgentEventsForTest } from "../../infra/agent-events.js";
import { getTaskRecord, loadTaskRegistryFromDisk } from "../../tasks/task-registry.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun } from "./queue.js";
import { __testing, maybeHandleVirtualForegroundTaskMessage } from "./task-aware-routing.js";

describe("task-aware routing", () => {
  const tempDirs: string[] = [];
  const callGatewayMock = vi.fn();
  const initializeSessionMock = vi.fn();
  const cancelSessionMock = vi.fn();

  beforeEach(() => {
    callGatewayMock.mockReset();
    initializeSessionMock.mockReset();
    cancelSessionMock.mockReset();
    resetAgentEventsForTest();
    __testing.setDepsForTests({
      callGateway: callGatewayMock,
      getAcpSessionManager: () =>
        ({
          initializeSession: initializeSessionMock,
          cancelSession: cancelSessionMock,
        }) as unknown as ReturnType<
          typeof import("../../acp/control-plane/manager.js").getAcpSessionManager
        >,
    });
  });

  afterEach(async () => {
    __testing.resetDepsForTests();
    resetAgentEventsForTest();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await Promise.all(
      tempDirs.map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function createFixture(params?: { sessionEntry?: SessionEntry }) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-aware-"));
    tempDirs.push(stateDir);
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "sess-main",
      updatedAt: Date.now(),
      ...params?.sessionEntry,
    };
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: sessionEntry,
    };
    await saveSessionStore(storePath, sessionStore);

    const followupRun = {
      prompt: "hello",
      summaryLine: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "main",
        agentDir: "/tmp",
        sessionId: "sess-main",
        sessionKey,
        messageProvider: "weixin",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/root/gitsource/myclaw",
        config: { acp: { enabled: true, defaultAgent: "codex", backend: "acpx" } },
        provider: "codex-vip",
        model: "gpt-5.2",
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun;
    const sessionCtx = {
      Provider: "weixin",
      Surface: "weixin",
      OriginatingChannel: "weixin",
      OriginatingTo: "wx:chat:1",
      To: "wx:chat:1",
      AccountId: "default",
      MessageSid: "msg-1",
    } as unknown as TemplateContext;

    return {
      stateDir,
      storePath,
      sessionKey,
      sessionEntry,
      sessionStore,
      followupRun,
      sessionCtx,
    };
  }

  async function flushTaskAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  it("opens an explicit task, binds it to the session, and tracks completion from agent events", async () => {
    const fixture = await createFixture();
    initializeSessionMock.mockResolvedValue({
      runtime: {},
      handle: { runtimeSessionName: "codex-task", backend: "acpx" },
      meta: {
        backend: "acpx",
        agent: "codex",
        runtimeSessionName: "codex-task",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
      },
    });
    callGatewayMock.mockImplementation(
      async (input: { method: string; params?: { idempotencyKey?: string } }) => {
        if (input.method === "sessions.patch") {
          return { ok: true, key: "agent:codex:acp:child" };
        }
        if (input.method === "agent") {
          return { runId: input.params?.idempotencyKey };
        }
        return {};
      },
    );

    const reply = await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "任务：帮我完善整个计划并测试到完全就绪",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });

    expect(reply?.text).toContain("已转给 Codex 持续处理");
    await flushTaskAsyncWork();
    const persistedStore = loadSessionStore(fixture.storePath, { skipCache: true });
    const foregroundTaskId = persistedStore[fixture.sessionKey]?.foregroundTaskId;
    expect(foregroundTaskId).toBeTruthy();

    const task = foregroundTaskId ? await getTaskRecord(foregroundTaskId) : undefined;
    expect(task?.orchestrator?.sessionKey).toContain("agent:codex:acp:");
    expect(
      callGatewayMock.mock.calls.some(
        (call) =>
          call[0]?.method === "agent" &&
          call[0]?.params?.deliver === true &&
          call[0]?.params?.sessionKey === task?.orchestrator?.sessionKey,
      ),
    ).toBe(true);

    const runId = callGatewayMock.mock.calls.find((call) => call[0]?.method === "agent")?.[0]
      ?.params?.idempotencyKey as string | undefined;
    emitAgentEvent({
      runId: runId ?? "missing",
      stream: "assistant",
      data: { text: "已经处理完毕，结果如下。" },
    });
    emitAgentEvent({
      runId: runId ?? "missing",
      stream: "lifecycle",
      data: { phase: "end" },
    });
    await flushTaskAsyncWork();

    const loaded = await loadTaskRegistryFromDisk();
    const updated = foregroundTaskId ? loaded.get(foregroundTaskId) : undefined;
    expect(updated?.state).toBe("done");
    expect(updated?.lastUserVisibleSummary).toContain("已经处理完毕");

    const finalStore = loadSessionStore(fixture.storePath, { skipCache: true });
    expect(finalStore[fixture.sessionKey]?.foregroundTaskId).toBeUndefined();
  });

  it("continues an existing foreground task and keeps it foreground when the child asks for input", async () => {
    const fixture = await createFixture();
    initializeSessionMock.mockResolvedValue({
      runtime: {},
      handle: { runtimeSessionName: "codex-task", backend: "acpx" },
      meta: {
        backend: "acpx",
        agent: "codex",
        runtimeSessionName: "codex-task",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
      },
    });
    callGatewayMock.mockImplementation(
      async (input: { method: string; params?: { idempotencyKey?: string } }) => {
        if (input.method === "sessions.patch") {
          return { ok: true, key: "agent:codex:acp:child" };
        }
        if (input.method === "agent") {
          return { runId: input.params?.idempotencyKey };
        }
        return {};
      },
    );

    const openReply = await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "任务：排查现在的路由慢在哪里",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    expect(openReply?.text).toContain("已转给 Codex");
    await flushTaskAsyncWork();

    const foregroundTaskId = loadSessionStore(fixture.storePath, { skipCache: true })[
      fixture.sessionKey
    ]?.foregroundTaskId;
    expect(foregroundTaskId).toBeTruthy();

    callGatewayMock.mockClear();
    const continueReply = await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "继续，把关键耗时链路列出来",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionStore[fixture.sessionKey],
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    expect(continueReply?.text).toContain("继续当前任务");
    await flushTaskAsyncWork();

    const runId = callGatewayMock.mock.calls.find((call) => call[0]?.method === "agent")?.[0]
      ?.params?.idempotencyKey as string | undefined;
    emitAgentEvent({
      runId: runId ?? "missing",
      stream: "assistant",
      data: { text: "请先提供最新的一条复现日志。" },
    });
    emitAgentEvent({
      runId: runId ?? "missing",
      stream: "lifecycle",
      data: { phase: "end" },
    });
    await flushTaskAsyncWork();

    const updated = foregroundTaskId ? await getTaskRecord(foregroundTaskId) : undefined;
    expect(updated?.state).toBe("waiting_user");
    expect(
      loadSessionStore(fixture.storePath, { skipCache: true })[fixture.sessionKey]
        ?.foregroundTaskId,
    ).toBe(foregroundTaskId);
  });

  it("pauses and stops a foreground task through ACP cancel", async () => {
    const fixture = await createFixture();
    initializeSessionMock.mockResolvedValue({
      runtime: {},
      handle: { runtimeSessionName: "codex-task", backend: "acpx" },
      meta: {
        backend: "acpx",
        agent: "codex",
        runtimeSessionName: "codex-task",
        mode: "persistent",
        state: "idle",
        lastActivityAt: Date.now(),
      },
    });
    callGatewayMock.mockImplementation(
      async (input: { method: string; params?: { idempotencyKey?: string } }) => {
        if (input.method === "sessions.patch") {
          return { ok: true, key: "agent:codex:acp:child" };
        }
        if (input.method === "agent") {
          return { runId: input.params?.idempotencyKey };
        }
        return {};
      },
    );

    await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "任务：持续优化耗时",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    await flushTaskAsyncWork();

    const foregroundTaskId = loadSessionStore(fixture.storePath, { skipCache: true })[
      fixture.sessionKey
    ]?.foregroundTaskId;
    const pauseReply = await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "暂停任务",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionStore[fixture.sessionKey],
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    expect(pauseReply?.text).toContain("已挂起当前任务");
    expect(cancelSessionMock).toHaveBeenCalledTimes(1);
    await flushTaskAsyncWork();

    await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "继续",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionStore[fixture.sessionKey],
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    await flushTaskAsyncWork();

    const cancelReply = await maybeHandleVirtualForegroundTaskMessage({
      commandBody: "停止任务",
      followupRun: fixture.followupRun,
      sessionCtx: fixture.sessionCtx,
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionStore[fixture.sessionKey],
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
    });
    expect(cancelReply?.text).toContain("已停止当前任务");
    await flushTaskAsyncWork();

    const updated = foregroundTaskId ? await getTaskRecord(foregroundTaskId) : undefined;
    expect(updated?.state).toBe("stopped");
  });
});
