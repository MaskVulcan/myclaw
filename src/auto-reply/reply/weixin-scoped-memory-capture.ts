import crypto from "node:crypto";
import fs from "node:fs/promises";
import { resolveCronStyleNow } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import {
  resolveWeixinDmScopedMemoryRelativePath,
  WEIXIN_DM_SCOPED_MEMORY_BOOTSTRAP_NAME,
} from "../../agents/weixin-dm-scoped-memory.js";
import { normalizeChatType } from "../../channels/chat-type.js";
import { resolveSessionTranscriptPath } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import type { TemplateContext } from "../templating.js";
import { isSilentReplyPrefixText, isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";
import type { ReplyPayload } from "../types.js";
import { resolveModelFallbackOptions, resolveRunAuthProfile } from "./agent-runner-utils.js";
import { enqueueFollowupRun, type FollowupRun, type QueueSettings } from "./queue.js";

const WEIXIN_PROVIDER_ID = "openclaw-weixin";
const SIDE_SESSION_THREAD_ID = 0;
const MEMORY_CAPTURE_SCORE_THRESHOLD = 2;
const MAX_CAPTURE_TEXT_CHARS = 1_600;
const MEMORY_CAPTURE_QUEUE_SETTINGS: QueueSettings = {
  mode: "queue",
  debounceMs: 1_200,
  cap: 1,
  dropPolicy: "old",
};

const EXPLICIT_MEMORY_RE =
  /(?:记住|记一下|记下来|记好|记着|记为|remember this|remember that|remember\b)/i;
const DURABLE_PREFERENCE_RE =
  /(?:默认|以后|今后|总是|优先|尽量|不要|别再|习惯|偏好|原则|风格|格式|口吻|人设|需求|约束|边界|工作方式|固定|统一|隔离|保留|共享|default|prefer|always|style|format|persona|principle|constraint|workflow)/i;
const USER_PROFILE_RE =
  /(?:我是|我在做|我主要|我的项目|我的库|我的仓库|我的目标|my project|my repo|i am\b|i'm\b|i usually\b|i prefer\b)/i;
const ASSISTANT_ACK_RE =
  /(?:我会记住|记住了|已记下|后续默认|按这个来|以后按这个|noted as default|i(?:'| wi)ll remember|noted for next time)/i;
const BULLET_LIST_RE = /^(?:[-*]|\d+\.)\s+/m;

type WeixinScopedMemoryCaptureCandidate = {
  sideSessionKey: string;
  followupRun: FollowupRun;
  score: number;
  targetRelativePath: string;
};

function resolveWeixinProvider(sessionCtx: TemplateContext): string | undefined {
  const candidates = [
    sessionCtx.OriginatingChannel,
    sessionCtx.Surface,
    sessionCtx.Provider,
  ] as const;
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function isWeixinDirectContext(sessionCtx: TemplateContext): boolean {
  if (resolveWeixinProvider(sessionCtx) !== WEIXIN_PROVIDER_ID) {
    return false;
  }
  const chatType = normalizeChatType(sessionCtx.ChatType);
  return !chatType || chatType === "direct";
}

function trimAndCollapseWhitespace(text: string | undefined): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function truncateForPrompt(text: string | undefined, maxChars = MAX_CAPTURE_TEXT_CHARS): string {
  const trimmed = trimAndCollapseWhitespace(text);
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n...[truncated]`;
}

function collectVisibleAssistantReplyText(payloads: ReplyPayload[]): string {
  const visibleParts = payloads
    .filter((payload) => !payload.isError && !payload.isReasoning)
    .map((payload) => trimAndCollapseWhitespace(payload.text))
    .filter(Boolean)
    .filter(
      (text) => !isSilentReplyText(text, SILENT_REPLY_TOKEN) && !isSilentReplyPrefixText(text),
    );
  return visibleParts.join("\n\n").trim();
}

export function scoreWeixinScopedMemoryCapture(params: {
  userText?: string;
  replyToText?: string;
  assistantText?: string;
}): number {
  const combined = [params.userText, params.replyToText, params.assistantText]
    .map(trimAndCollapseWhitespace)
    .filter(Boolean)
    .join("\n");
  if (!combined) {
    return 0;
  }

  let score = 0;
  if (EXPLICIT_MEMORY_RE.test(combined)) {
    score += 2;
  }
  if (DURABLE_PREFERENCE_RE.test(combined)) {
    score += 2;
  }
  if (USER_PROFILE_RE.test(combined)) {
    score += 1;
  }
  if (BULLET_LIST_RE.test(combined)) {
    score += 1;
  }
  if (ASSISTANT_ACK_RE.test(trimAndCollapseWhitespace(params.assistantText))) {
    score += 2;
  }
  return score;
}

function buildWeixinScopedMemoryCaptureSystemPrompt(params: {
  targetRelativePath: string;
}): string {
  return [
    "Weixin DM scoped memory capture turn.",
    `Write only to ${params.targetRelativePath} (exposed in Project Context as ${WEIXIN_DM_SCOPED_MEMORY_BOOTSTRAP_NAME}).`,
    "Append concise durable notes only; do not overwrite or rewrite existing content.",
    "Do not write DM-specific notes into shared MEMORY.md.",
    "Store only stable user-specific memory: preferences, defaults, principles, persona/profile facts, project continuity, constraints, and follow-up expectations.",
    "Skip transient asks, one-off chatter, secrets, and low-confidence guesses.",
    `Usually reply with ${SILENT_REPLY_TOKEN}.`,
  ].join(" ");
}

export function buildWeixinScopedMemoryCapturePrompt(params: {
  cfg: FollowupRun["run"]["config"];
  targetRelativePath: string;
  userText?: string;
  replyToText?: string;
  assistantText?: string;
  nowMs?: number;
}): string {
  const nowMs = Number.isFinite(params.nowMs) ? (params.nowMs as number) : Date.now();
  const { timeLine } = resolveCronStyleNow(params.cfg ?? {}, nowMs);
  const sections = [
    "Review the just-finished Weixin direct-message turn and capture only durable, user-specific memory.",
    `Target file: ${params.targetRelativePath}`,
    "Rules:",
    "- Write only to this DM-scoped memory file.",
    "- Append concise bullets under Durable Notes; do not overwrite existing content.",
    "- Keep only durable facts: preferences, defaults, principles, persona/profile facts, ongoing goals/projects, stable constraints, and future follow-up expectations.",
    "- Do not store transient troubleshooting noise, one-off requests, secrets, or low-confidence guesses.",
    "- If nothing durable changed, reply with NO_REPLY.",
    timeLine,
  ];

  const userText = truncateForPrompt(params.userText);
  if (userText) {
    sections.push("", "Current user message:", "```text", userText, "```");
  }

  const replyToText = truncateForPrompt(params.replyToText, 900);
  if (replyToText) {
    sections.push("", "Quoted / replied-to context:", "```text", replyToText, "```");
  }

  const assistantText = truncateForPrompt(params.assistantText);
  if (assistantText) {
    sections.push("", "Assistant reply from the completed turn:", "```text", assistantText, "```");
  }

  sections.push("", `If nothing durable should be added, reply with ${SILENT_REPLY_TOKEN}.`);
  return sections.join("\n");
}

export function resolveWeixinScopedMemoryCaptureCandidate(params: {
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  payloads: ReplyPayload[];
}): WeixinScopedMemoryCaptureCandidate | null {
  if (!isWeixinDirectContext(params.sessionCtx)) {
    return null;
  }

  const sessionKey = params.followupRun.run.sessionKey?.trim();
  if (!sessionKey) {
    return null;
  }

  const targetRelativePath = resolveWeixinDmScopedMemoryRelativePath(sessionKey);
  if (!targetRelativePath) {
    return null;
  }

  const userText = trimAndCollapseWhitespace(
    typeof params.sessionCtx.BodyStripped === "string"
      ? params.sessionCtx.BodyStripped
      : params.sessionCtx.Body,
  );
  const replyToText = trimAndCollapseWhitespace(
    typeof params.sessionCtx.ReplyToBody === "string" ? params.sessionCtx.ReplyToBody : undefined,
  );
  const assistantText = collectVisibleAssistantReplyText(params.payloads);
  const score = scoreWeixinScopedMemoryCapture({
    userText,
    replyToText,
    assistantText,
  });
  if (score < MEMORY_CAPTURE_SCORE_THRESHOLD) {
    return null;
  }

  const sideSessionKey = `${sessionKey}:thread:${SIDE_SESSION_THREAD_ID}`;
  const sideSessionId = `wx-memory-${crypto.randomUUID()}`;
  const sessionFile = resolveSessionTranscriptPath(sideSessionId, params.followupRun.run.agentId);
  const prompt = buildWeixinScopedMemoryCapturePrompt({
    cfg: params.followupRun.run.config,
    targetRelativePath,
    userText,
    replyToText,
    assistantText,
  });

  return {
    sideSessionKey,
    score,
    targetRelativePath,
    followupRun: {
      prompt,
      messageId: params.followupRun.messageId,
      summaryLine: "weixin scoped memory capture",
      enqueuedAt: Date.now(),
      run: {
        ...params.followupRun.run,
        sessionId: sideSessionId,
        sessionKey: sideSessionKey,
        sessionFile,
        thinkLevel: "off",
        verboseLevel: "off",
        reasoningLevel: "off",
        fastMode: true,
        timeoutMs: Math.min(params.followupRun.run.timeoutMs, 45_000),
        extraSystemPrompt: buildWeixinScopedMemoryCaptureSystemPrompt({
          targetRelativePath,
        }),
      },
    },
  };
}

async function cleanupMemoryCaptureSessionFiles(params: {
  followupRun: FollowupRun;
  resolvedSessionId?: string;
}): Promise<void> {
  const candidates = new Set<string>();
  candidates.add(params.followupRun.run.sessionFile);
  const resolvedSessionId = params.resolvedSessionId?.trim();
  if (
    resolvedSessionId &&
    resolvedSessionId !== params.followupRun.run.sessionId &&
    params.followupRun.run.agentId
  ) {
    candidates.add(resolveSessionTranscriptPath(resolvedSessionId, params.followupRun.run.agentId));
  }
  await Promise.allSettled(
    [...candidates].filter(Boolean).map(async (candidate) => {
      await fs.rm(candidate, { force: true }).catch(() => {});
    }),
  );
}

export async function runWeixinScopedMemoryCaptureTurn(queued: FollowupRun): Promise<void> {
  const runId = crypto.randomUUID();
  try {
    const fallbackResult = await runWithModelFallback({
      ...resolveModelFallbackOptions(queued.run),
      runId,
      run: async (provider, model, runOptions) => {
        const authProfile = resolveRunAuthProfile(queued.run, provider);
        const result = await runEmbeddedPiAgent({
          allowGatewaySubagentBinding: true,
          sessionId: queued.run.sessionId,
          sessionKey: queued.run.sessionKey,
          agentId: queued.run.agentId,
          trigger: "memory",
          messageProvider: queued.run.messageProvider,
          agentAccountId: queued.run.agentAccountId,
          groupId: queued.run.groupId,
          groupChannel: queued.run.groupChannel,
          groupSpace: queued.run.groupSpace,
          senderId: queued.run.senderId,
          senderName: queued.run.senderName,
          senderUsername: queued.run.senderUsername,
          senderE164: queued.run.senderE164,
          senderIsOwner: queued.run.senderIsOwner,
          sessionFile: queued.run.sessionFile,
          agentDir: queued.run.agentDir,
          workspaceDir: queued.run.workspaceDir,
          config: queued.run.config,
          skillsSnapshot: queued.run.skillsSnapshot,
          prompt: queued.prompt,
          extraSystemPrompt: queued.run.extraSystemPrompt,
          ownerNumbers: queued.run.ownerNumbers,
          enforceFinalTag: queued.run.enforceFinalTag,
          provider,
          model,
          ...authProfile,
          thinkLevel: queued.run.thinkLevel,
          fastMode: queued.run.fastMode,
          verboseLevel: queued.run.verboseLevel,
          reasoningLevel: queued.run.reasoningLevel,
          execOverrides: queued.run.execOverrides,
          bashElevated: queued.run.bashElevated,
          timeoutMs: queued.run.timeoutMs,
          runId,
          allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
          blockReplyBreak: queued.run.blockReplyBreak,
        });
        return result;
      },
    });
    await cleanupMemoryCaptureSessionFiles({
      followupRun: queued,
      resolvedSessionId: fallbackResult.result.meta?.agentMeta?.sessionId,
    });
  } catch (err) {
    await cleanupMemoryCaptureSessionFiles({ followupRun: queued });
    logVerbose(`weixin scoped memory capture failed: ${String(err)}`);
  }
}

export function maybeEnqueueWeixinScopedMemoryCapture(params: {
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  payloads: ReplyPayload[];
}): boolean {
  const candidate = resolveWeixinScopedMemoryCaptureCandidate(params);
  if (!candidate) {
    return false;
  }
  const queueKey = `weixin-memory:${candidate.sideSessionKey}`;
  const enqueued = enqueueFollowupRun(
    queueKey,
    candidate.followupRun,
    MEMORY_CAPTURE_QUEUE_SETTINGS,
    "prompt",
    runWeixinScopedMemoryCaptureTurn,
  );
  if (enqueued) {
    logVerbose(
      `queued weixin scoped memory capture: sessionKey=${candidate.sideSessionKey} score=${candidate.score} target=${candidate.targetRelativePath}`,
    );
  }
  return enqueued;
}
