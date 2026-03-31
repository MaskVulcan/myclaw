import crypto from "node:crypto";
import { getAcpSessionManager } from "../../acp/control-plane/manager.js";
import { isAcpEnabledByPolicy, resolveAcpAgentPolicyError } from "../../acp/policy.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import { onAgentEvent } from "../../infra/agent-events.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  bindForegroundTaskToSession,
  clearForegroundTaskForSession,
  suspendForegroundTaskForSession,
} from "../../tasks/session-pointers.js";
import {
  appendTaskEvent,
  createTaskRecord,
  createTaskWorkerRecord,
  getTaskRecord,
  patchTaskRecord,
  upsertTaskRecord,
} from "../../tasks/task-registry.js";
import type { TaskRecord } from "../../tasks/types.js";
import type { TemplateContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import type { FollowupRun } from "./queue.js";

type TaskAwareContext = {
  commandBody: string;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  isHeartbeat?: boolean;
};

type TaskIntent =
  | { kind: "none" }
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "cancel" }
  | { kind: "continue" }
  | { kind: "open"; explicit: boolean; body: string };

type GatewayCall = typeof callGateway;

const TASK_PREFIX_RE = /^(?:\/?task|任务|任务[:：]|新任务|开始任务|创建任务)\s*[:：]?\s*/i;
const STATUS_RE = /^(?:任务状态|状态|进度|进展|status|progress|还在吗|现在怎么样)/i;
const PAUSE_RE =
  /^(?:暂停(?:任务)?|挂起(?:任务)?|先停(?:一下)?|hold|pause)(?:$|[\s，,：:。.!！?？])/i;
const CANCEL_RE =
  /^(?:取消(?:任务)?|结束(?:任务)?|停止(?:任务)?|stop|cancel)(?:$|[\s，,：:。.!！?？])/i;
const CONTINUE_RE =
  /^(?:继续(?:任务|处理|做)?|接着(?:做|处理)?|resume|go on)(?:$|[\s，,：:。.!！?？])/i;
const EXECUTION_VERB_RE =
  /(完善|优化|实现|修改|修复|排查|调查|分析|检查|测试|编写|重构|安装|部署|处理|继续|跟进|完成|整理|搭建|接入|联调)/;
const SIMPLE_QUESTION_RE = /(是什么|为什么|怎么|多少|吗[？?]?|^\s*(?:how|what|why|when|where)\b)/i;
const WAITING_USER_RE =
  /(请(?:先)?提供|需要你|需要您|告诉我|把.*发我|补充|确认一下|是否|可以提供|还需要|先确认)/;

const defaultTaskAwareDeps = {
  callGateway,
  getAcpSessionManager,
};

const taskAwareDeps = {
  ...defaultTaskAwareDeps,
};

export const __testing = {
  setDepsForTests(
    deps:
      | Partial<{
          callGateway: GatewayCall;
          getAcpSessionManager: typeof getAcpSessionManager;
        }>
      | undefined,
  ) {
    taskAwareDeps.callGateway = deps?.callGateway ?? defaultTaskAwareDeps.callGateway;
    taskAwareDeps.getAcpSessionManager =
      deps?.getAcpSessionManager ?? defaultTaskAwareDeps.getAcpSessionManager;
  },
  resetDepsForTests() {
    taskAwareDeps.callGateway = defaultTaskAwareDeps.callGateway;
    taskAwareDeps.getAcpSessionManager = defaultTaskAwareDeps.getAcpSessionManager;
  },
};

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function resolveTaskIntent(params: {
  text: string;
  hasForegroundTask: boolean;
  hasRecentTask: boolean;
}): TaskIntent {
  const text = normalizeText(params.text);
  if (!text) {
    return { kind: "none" };
  }
  if (STATUS_RE.test(text) && (params.hasForegroundTask || params.hasRecentTask)) {
    return { kind: "status" };
  }
  if (PAUSE_RE.test(text) && params.hasForegroundTask) {
    return { kind: "pause" };
  }
  if (CANCEL_RE.test(text) && params.hasForegroundTask) {
    return { kind: "cancel" };
  }
  if (CONTINUE_RE.test(text) && (params.hasForegroundTask || params.hasRecentTask)) {
    return { kind: "continue" };
  }
  if (TASK_PREFIX_RE.test(text)) {
    return {
      kind: "open",
      explicit: true,
      body: text.replace(TASK_PREFIX_RE, "").trim() || text,
    };
  }

  const longOrStructured = text.length >= 48 || text.includes("\n") || text.includes("```");
  const shouldAutoOpen =
    !params.hasForegroundTask &&
    longOrStructured &&
    EXECUTION_VERB_RE.test(text) &&
    !SIMPLE_QUESTION_RE.test(text);
  if (shouldAutoOpen) {
    return { kind: "open", explicit: false, body: text };
  }
  return { kind: "none" };
}

function buildTaskTitle(body: string): string {
  const cleaned = normalizeText(body).replace(TASK_PREFIX_RE, "").trim();
  const firstLine = cleaned.split("\n")[0]?.trim() ?? cleaned;
  const collapsed = firstLine.replace(/\s+/g, " ");
  return (collapsed || "新任务").slice(0, 48);
}

function buildTaskLaunchPrompt(params: {
  title: string;
  goal: string;
  acceptance?: string;
}): string {
  return [
    "你现在在一个独立的持久化任务会话里处理这项工作。",
    `任务标题：${params.title}`,
    `任务目标：${params.goal}`,
    params.acceptance ? `验收标准：${params.acceptance}` : undefined,
    "要求：",
    "- 直接开始处理，不要重复复述全部背景。",
    "- 对用户可见的回复保持简洁。",
    "- 如果缺少信息，只提最小必要问题。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildContinuePrompt(userText: string): string {
  return ["[Task Follow-up]", normalizeText(userText)].join("\n");
}

function resolveOwnerChannel(ctx: TemplateContext): string | undefined {
  return normalizeText(ctx.OriginatingChannel ?? ctx.Surface ?? ctx.Provider) || undefined;
}

function resolveOwnerConversationId(ctx: TemplateContext): string | undefined {
  return (
    normalizeText(ctx.OriginatingTo ?? ctx.To) ||
    normalizeText(typeof ctx.MessageThreadId === "string" ? ctx.MessageThreadId : undefined) ||
    undefined
  );
}

function resolveOwnerDelivery(params: { ctx: TemplateContext }): {
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string;
} {
  const threadIdRaw = params.ctx.MessageThreadId;
  return {
    channel: resolveOwnerChannel(params.ctx),
    to: normalizeText(params.ctx.OriginatingTo ?? params.ctx.To) || undefined,
    accountId: normalizeText(params.ctx.AccountId) || undefined,
    threadId:
      typeof threadIdRaw === "number" && Number.isFinite(threadIdRaw)
        ? String(Math.trunc(threadIdRaw))
        : normalizeText(typeof threadIdRaw === "string" ? threadIdRaw : undefined) || undefined,
  };
}

function resolveTargetTaskAgentId(cfg: OpenClawConfig): string {
  return normalizeAgentId(cfg.acp?.defaultAgent?.trim() || "codex");
}

function inferWaitingUserFromText(text?: string): boolean {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    return false;
  }
  return WAITING_USER_RE.test(trimmed) || /[？?]\s*$/.test(trimmed);
}

function summarizeAssistantText(text?: string): string | undefined {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 277)}...`;
}

type DispatchTaskTurnParams = {
  cfg: OpenClawConfig;
  ownerSessionKey: string;
  taskId: string;
  childSessionKey: string;
  message: string;
  delivery: ReturnType<typeof resolveOwnerDelivery>;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
};

function registerTaskRunMonitor(params: {
  taskId: string;
  ownerSessionKey: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  runId: string;
}) {
  let latestAssistantText: string | undefined;
  const dispose = onAgentEvent((event) => {
    if (event.runId !== params.runId) {
      return;
    }
    if (event.stream === "assistant") {
      const text = normalizeText(
        typeof event.data?.text === "string" ? event.data.text : undefined,
      );
      if (text) {
        latestAssistantText = text;
      }
      return;
    }
    if (event.stream !== "lifecycle") {
      return;
    }
    const phase = normalizeText(
      typeof event.data?.phase === "string" ? event.data.phase : undefined,
    );
    if (!phase || (phase !== "end" && phase !== "error")) {
      return;
    }
    dispose();
    void (async () => {
      if (phase === "error") {
        const errorText =
          summarizeAssistantText(
            typeof event.data?.error === "string" ? event.data.error : latestAssistantText,
          ) ?? "任务执行失败。";
        await patchTaskRecord(params.taskId, (current) =>
          current
            ? {
                ...current,
                state: "failed",
                lastDigest: errorText,
                lastUserVisibleSummary: errorText,
                finishedAt: Date.now(),
                lastActivityAt: Date.now(),
                updatedAt: Date.now(),
                error: {
                  at: Date.now(),
                  message: errorText,
                },
              }
            : undefined,
        );
        await appendTaskEvent({
          taskId: params.taskId,
          type: "dispatch_failed",
          at: Date.now(),
          actor: "executor",
          summary: errorText,
          data: { runId: params.runId, phase },
        });
        await clearForegroundTaskForSession({
          sessionKey: params.ownerSessionKey,
          sessionEntry: params.sessionEntry,
          sessionStore: params.sessionStore,
          storePath: params.storePath,
          taskId: params.taskId,
        });
        return;
      }

      const summary = summarizeAssistantText(latestAssistantText) ?? "任务已结束。";
      const waitingUser = inferWaitingUserFromText(latestAssistantText);
      await patchTaskRecord(params.taskId, (current) =>
        current
          ? {
              ...current,
              state: waitingUser ? "waiting_user" : "done",
              lastDigest: summary,
              lastUserVisibleSummary: summary,
              finishedAt: waitingUser ? undefined : Date.now(),
              lastActivityAt: Date.now(),
              updatedAt: Date.now(),
            }
          : undefined,
      );
      await appendTaskEvent({
        taskId: params.taskId,
        type: waitingUser ? "waiting_user" : "dispatch_completed",
        at: Date.now(),
        actor: "executor",
        summary,
        data: { runId: params.runId, phase },
      });
      if (!waitingUser) {
        await clearForegroundTaskForSession({
          sessionKey: params.ownerSessionKey,
          sessionEntry: params.sessionEntry,
          sessionStore: params.sessionStore,
          storePath: params.storePath,
          taskId: params.taskId,
        });
      }
    })();
  });

  const timeout = setTimeout(
    () => {
      dispose();
      void appendTaskEvent({
        taskId: params.taskId,
        type: "dispatch_monitor_expired",
        at: Date.now(),
        actor: "system",
        summary: "task run monitor expired before a terminal lifecycle event arrived",
        data: { runId: params.runId },
      });
    },
    60 * 60 * 1000,
  );
  timeout.unref?.();
}

async function dispatchTaskTurn(params: DispatchTaskTurnParams): Promise<void> {
  const runId = crypto.randomUUID();
  registerTaskRunMonitor({
    taskId: params.taskId,
    ownerSessionKey: params.ownerSessionKey,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
    runId,
  });
  await patchTaskRecord(params.taskId, (current) =>
    current
      ? {
          ...current,
          state: "running",
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
          retryCount: current.retryCount ?? 0,
        }
      : undefined,
  );
  await appendTaskEvent({
    taskId: params.taskId,
    type: "dispatch_started",
    at: Date.now(),
    actor: "executor",
    summary: "queued task turn to child ACP session",
    data: { childSessionKey: params.childSessionKey, runId },
  });
  try {
    await taskAwareDeps.callGateway({
      method: "agent",
      params: {
        message: params.message,
        sessionKey: params.childSessionKey,
        channel: params.delivery.channel,
        to: params.delivery.to,
        accountId: params.delivery.accountId,
        threadId: params.delivery.threadId,
        deliver: true,
        timeout: 0,
        idempotencyKey: runId,
      },
      timeoutMs: 15_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchTaskRecord(params.taskId, (current) =>
      current
        ? {
            ...current,
            state: "failed",
            lastDigest: message,
            lastUserVisibleSummary: message,
            lastActivityAt: Date.now(),
            updatedAt: Date.now(),
            error: {
              at: Date.now(),
              message,
            },
          }
        : undefined,
    );
    await appendTaskEvent({
      taskId: params.taskId,
      type: "dispatch_failed_to_queue",
      at: Date.now(),
      actor: "executor",
      summary: message,
      data: { childSessionKey: params.childSessionKey, runId },
    });
    await clearForegroundTaskForSession({
      sessionKey: params.ownerSessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      taskId: params.taskId,
    });
  }
}

async function ensurePersistentTaskChildSession(params: {
  cfg: OpenClawConfig;
  ownerSessionKey: string;
  label: string;
  cwd?: string;
}): Promise<{ childSessionKey: string; targetAgentId: string }> {
  const targetAgentId = resolveTargetTaskAgentId(params.cfg);
  if (!isAcpEnabledByPolicy(params.cfg)) {
    throw new Error("ACP is disabled by policy.");
  }
  const agentPolicyError = resolveAcpAgentPolicyError(params.cfg, targetAgentId);
  if (agentPolicyError) {
    throw new Error(agentPolicyError.message);
  }
  const childSessionKey = `agent:${targetAgentId}:acp:${crypto.randomUUID()}`;
  await taskAwareDeps.callGateway({
    method: "sessions.patch",
    params: {
      key: childSessionKey,
      spawnedBy: params.ownerSessionKey,
      label: params.label,
    },
    timeoutMs: 10_000,
  });
  await taskAwareDeps.getAcpSessionManager().initializeSession({
    cfg: params.cfg,
    sessionKey: childSessionKey,
    agent: targetAgentId,
    mode: "persistent",
    cwd: params.cwd,
    backendId: params.cfg.acp?.backend,
  });
  return { childSessionKey, targetAgentId };
}

async function createAndLaunchTask(
  params: TaskAwareContext & {
    body: string;
    explicit: boolean;
    currentForegroundTaskId?: string;
  },
): Promise<ReplyPayload | null> {
  const cfg = params.followupRun.run.config;
  const ownerSessionKey = normalizeText(params.sessionKey);
  if (!ownerSessionKey) {
    return null;
  }
  const ownerChannel = resolveOwnerChannel(params.sessionCtx);
  const delivery = resolveOwnerDelivery({ ctx: params.sessionCtx });
  if (!ownerChannel || !delivery.to) {
    return params.explicit
      ? {
          text: "当前会话没有可用的投递目标，暂时不能创建任务。",
          isError: true,
        }
      : null;
  }

  const title = buildTaskTitle(params.body);
  const now = Date.now();
  try {
    if (params.currentForegroundTaskId) {
      await suspendForegroundTaskForSession({
        sessionKey: ownerSessionKey,
        sessionEntry: params.sessionEntry,
        sessionStore: params.sessionStore,
        storePath: params.storePath,
        taskId: params.currentForegroundTaskId,
      });
    }

    const { childSessionKey, targetAgentId } = await ensurePersistentTaskChildSession({
      cfg,
      ownerSessionKey,
      label: title,
      cwd: params.followupRun.run.workspaceDir,
    });
    const taskId = `task:${crypto.randomUUID()}`;
    const orchestrator = createTaskWorkerRecord({
      workerId: "executor",
      role: "executor",
      backend: "acp-codex",
      state: "idle",
      sessionKey: childSessionKey,
      createdAt: now,
      updatedAt: now,
      model: targetAgentId,
      cwd: params.followupRun.run.workspaceDir,
    });
    await upsertTaskRecord(
      createTaskRecord({
        taskId,
        ownerSessionKey,
        ownerChannel,
        ownerAccountId: delivery.accountId,
        ownerConversationId: resolveOwnerConversationId(params.sessionCtx),
        ownerDeliveryContext: {
          channel: delivery.channel,
          to: delivery.to,
          accountId: delivery.accountId,
          threadId: delivery.threadId,
        },
        routeMode: "virtual_foreground",
        title,
        goal: params.body,
        acceptance: "完成用户请求；如缺少信息，明确指出阻塞项。",
        cwd: params.followupRun.run.workspaceDir,
        state: "pending_dispatch",
        backend: "acp-codex",
        foreground: true,
        priority: 50,
        orchestrator,
        workers: [orchestrator],
        createdAt: now,
        updatedAt: now,
        lastDigest: "任务已创建，等待分发。",
        lastUserVisibleSummary: "任务已创建，等待分发。",
        lastActivityAt: now,
      }),
    );
    await appendTaskEvent({
      taskId,
      type: "task_created",
      at: now,
      actor: "router",
      summary: title,
      data: { childSessionKey },
    });
    await bindForegroundTaskToSession({
      sessionKey: ownerSessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      taskId,
    });
    void dispatchTaskTurn({
      cfg,
      ownerSessionKey,
      taskId,
      childSessionKey,
      message: buildTaskLaunchPrompt({
        title,
        goal: params.body,
        acceptance: "完成用户请求；如缺少信息，明确指出阻塞项。",
      }),
      delivery,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
    });
    return {
      text: `已转给 Codex 持续处理：${title}`,
    };
  } catch (error) {
    if (!params.explicit) {
      return null;
    }
    return {
      text: `创建任务失败：${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

async function continueExistingTask(
  params: TaskAwareContext & {
    task: TaskRecord;
  },
): Promise<ReplyPayload | null> {
  const childSessionKey = params.task.orchestrator?.sessionKey?.trim();
  if (!childSessionKey) {
    return {
      text: "当前任务没有可用的执行会话。",
      isError: true,
    };
  }
  const ownerSessionKey = normalizeText(params.sessionKey);
  if (!ownerSessionKey) {
    return null;
  }
  const delivery = resolveOwnerDelivery({ ctx: params.sessionCtx });
  const body = normalizeText(params.commandBody);
  await appendTaskEvent({
    taskId: params.task.taskId,
    type: "user_followup",
    at: Date.now(),
    actor: "user",
    summary: body,
  });
  await bindForegroundTaskToSession({
    sessionKey: ownerSessionKey,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
    taskId: params.task.taskId,
  });
  void dispatchTaskTurn({
    cfg: params.followupRun.run.config,
    ownerSessionKey,
    taskId: params.task.taskId,
    childSessionKey,
    message: buildContinuePrompt(body),
    delivery,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
  });
  return {
    text: `收到，继续当前任务：${params.task.title}`,
  };
}

async function handleStatusRequest(task: TaskRecord | undefined): Promise<ReplyPayload> {
  if (!task) {
    return {
      text: "当前没有前台任务。",
    };
  }
  const summary =
    summarizeAssistantText(task.lastUserVisibleSummary ?? task.lastDigest) ?? "暂无摘要。";
  return {
    text: [`当前任务：${task.title}`, `状态：${task.state}`, `最近：${summary}`].join("\n"),
  };
}

async function handlePauseRequest(
  params: TaskAwareContext & {
    task: TaskRecord;
  },
): Promise<ReplyPayload> {
  const childSessionKey = params.task.orchestrator?.sessionKey?.trim();
  if (childSessionKey) {
    try {
      await taskAwareDeps.getAcpSessionManager().cancelSession({
        cfg: params.followupRun.run.config,
        sessionKey: childSessionKey,
        reason: "task-paused",
      });
    } catch {
      // best-effort
    }
  }
  await patchTaskRecord(params.task.taskId, (current) =>
    current
      ? {
          ...current,
          state: "waiting_user",
          lastDigest: "任务已挂起，等待用户继续。",
          lastUserVisibleSummary: "任务已挂起，等待用户继续。",
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
        }
      : undefined,
  );
  await appendTaskEvent({
    taskId: params.task.taskId,
    type: "task_suspended",
    at: Date.now(),
    actor: "router",
    summary: "task paused by user",
  });
  if (params.sessionKey) {
    await suspendForegroundTaskForSession({
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      taskId: params.task.taskId,
    });
  }
  return {
    text: `已挂起当前任务：${params.task.title}`,
  };
}

async function handleCancelRequest(
  params: TaskAwareContext & {
    task: TaskRecord;
  },
): Promise<ReplyPayload> {
  const childSessionKey = params.task.orchestrator?.sessionKey?.trim();
  if (childSessionKey) {
    try {
      await taskAwareDeps.getAcpSessionManager().cancelSession({
        cfg: params.followupRun.run.config,
        sessionKey: childSessionKey,
        reason: "task-stopped",
      });
    } catch {
      // best-effort
    }
  }
  await patchTaskRecord(params.task.taskId, (current) =>
    current
      ? {
          ...current,
          state: "stopped",
          foreground: false,
          lastDigest: "任务已停止。",
          lastUserVisibleSummary: "任务已停止。",
          finishedAt: Date.now(),
          lastActivityAt: Date.now(),
          updatedAt: Date.now(),
        }
      : undefined,
  );
  await appendTaskEvent({
    taskId: params.task.taskId,
    type: "task_stopped",
    at: Date.now(),
    actor: "router",
    summary: "task stopped by user",
  });
  if (params.sessionKey) {
    await clearForegroundTaskForSession({
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      taskId: params.task.taskId,
      removeFromSuspended: true,
    });
  }
  return {
    text: `已停止当前任务：${params.task.title}`,
  };
}

export async function maybeHandleVirtualForegroundTaskMessage(
  params: TaskAwareContext,
): Promise<ReplyPayload | null> {
  if (params.isHeartbeat) {
    return null;
  }
  const text = normalizeText(params.commandBody);
  if (!text) {
    return null;
  }
  const currentForegroundTaskId = normalizeText(params.sessionEntry?.foregroundTaskId) || undefined;
  const recentTaskId = params.sessionEntry?.recentTaskIds?.[0]?.trim() || undefined;
  let foregroundTask = currentForegroundTaskId
    ? await getTaskRecord(currentForegroundTaskId)
    : undefined;
  if (!foregroundTask && currentForegroundTaskId && params.sessionKey) {
    await clearForegroundTaskForSession({
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      taskId: currentForegroundTaskId,
    });
  }

  const intent = resolveTaskIntent({
    text,
    hasForegroundTask: Boolean(foregroundTask),
    hasRecentTask: Boolean(recentTaskId),
  });
  if (intent.kind === "none") {
    return null;
  }

  if (intent.kind === "status") {
    return await handleStatusRequest(
      foregroundTask ?? (recentTaskId ? await getTaskRecord(recentTaskId) : undefined),
    );
  }

  if (intent.kind === "open") {
    return await createAndLaunchTask({
      ...params,
      body: intent.body,
      explicit: intent.explicit,
      currentForegroundTaskId,
    });
  }

  const activeTask =
    foregroundTask ?? (recentTaskId ? await getTaskRecord(recentTaskId) : undefined);
  if (!activeTask) {
    return null;
  }

  if (intent.kind === "pause") {
    return await handlePauseRequest({ ...params, task: activeTask });
  }
  if (intent.kind === "cancel") {
    return await handleCancelRequest({ ...params, task: activeTask });
  }
  return await continueExistingTask({ ...params, task: activeTask });
}
