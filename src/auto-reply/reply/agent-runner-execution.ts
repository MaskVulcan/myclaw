import crypto from "node:crypto";
import fs from "node:fs";
import {
  hasOutboundReplyContent,
  resolveSendableOutboundReplyParts,
} from "openclaw/plugin-sdk/reply-payload";
import { resolveBootstrapWarningSignaturesSeen } from "../../agents/bootstrap-budget.js";
import { runCliAgent } from "../../agents/cli-runner.js";
import { getCliSessionBinding } from "../../agents/cli-session.js";
import {
  resolvePersistedLiveSessionModelSelection,
  LiveSessionModelSwitchError,
} from "../../agents/live-model-switch.js";
import { runWithModelFallback, isFallbackSummaryError } from "../../agents/model-fallback.js";
import { isCliProvider } from "../../agents/model-selection.js";
import {
  BILLING_ERROR_USER_MESSAGE,
  isCompactionFailureError,
  isContextOverflowError,
  isBillingErrorMessage,
  isLikelyContextOverflowError,
  isOverloadedErrorMessage,
  isRateLimitErrorMessage,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../agents/pi-embedded-helpers.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import {
  resolveGroupSessionKey,
  resolveSessionTranscriptPath,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent, registerAgentRunContext } from "../../infra/agent-events.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { defaultRuntime } from "../../runtime.js";
import {
  isMarkdownCapableMessageChannel,
  resolveMessageChannel,
} from "../../utils/message-channel.js";
import { isInternalMessageChannel } from "../../utils/message-channel.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { TemplateContext } from "../templating.js";
import type { VerboseLevel } from "../thinking.js";
import {
  HEARTBEAT_TOKEN,
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import {
  buildEmbeddedRunExecutionParams,
  resolveMultiStageRoutingPlan,
  resolveModelFallbackOptions,
  type EmbeddedRunStagePlan,
} from "./agent-runner-utils.js";
import { type BlockReplyPipeline } from "./block-reply-pipeline.js";
import type { FollowupRun } from "./queue.js";
import { createBlockReplyDeliveryHandler } from "./reply-delivery.js";
import { createReplyMediaPathNormalizer } from "./reply-media-paths.runtime.js";
import { extractReplyToTag } from "./reply-tags.js";
import type { TypingSignaler } from "./typing-mode.js";

export type RuntimeFallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: string;
  status?: number;
  code?: string;
};

export type AgentRunLoopResult =
  | {
      kind: "success";
      runId: string;
      runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
      fallbackProvider?: string;
      fallbackModel?: string;
      fallbackAttempts: RuntimeFallbackAttempt[];
      didLogHeartbeatStrip: boolean;
      autoCompactionCount: number;
      /** Payload keys sent directly (not via pipeline) during tool flush. */
      directlySentBlockKeys?: Set<string>;
    }
  | { kind: "final"; payload: ReplyPayload };

const multiStageLog = createSubsystemLogger("gateway/multi-stage-routing");

/**
 * Build a human-friendly rate-limit message from a FallbackSummaryError.
 * Includes a countdown when the soonest cooldown expiry is known.
 */
function buildRateLimitCooldownMessage(err: unknown): string {
  if (!isFallbackSummaryError(err)) {
    return "⚠️ All models are temporarily rate-limited. Please try again in a few minutes.";
  }
  const expiry = err.soonestCooldownExpiry;
  const now = Date.now();
  if (typeof expiry === "number" && expiry > now) {
    const secsLeft = Math.max(1, Math.ceil((expiry - now) / 1000));
    if (secsLeft <= 60) {
      return `⚠️ Rate-limited — ready in ~${secsLeft}s. Please wait a moment.`;
    }
    const minsLeft = Math.ceil(secsLeft / 60);
    return `⚠️ Rate-limited — ready in ~${minsLeft} min. Please try again shortly.`;
  }
  return "⚠️ All models are temporarily rate-limited. Please try again in a few minutes.";
}

function isPureTransientRateLimitSummary(err: unknown): boolean {
  return (
    isFallbackSummaryError(err) &&
    err.attempts.length > 0 &&
    err.attempts.every((attempt) => {
      const reason = attempt.reason;
      return reason === "rate_limit" || reason === "overloaded";
    })
  );
}

type SessionFileSnapshot = {
  exists: boolean;
  contents?: string;
};

function normalizeEscalationReplyText(text?: string): string {
  const cleaned = extractReplyToTag(text).cleaned.trim();
  return cleaned.replace(/\s+/g, " ");
}

function shouldEscalateStageResult(params: {
  runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
  marker: string;
}): boolean {
  const visibleTexts =
    params.runResult.payloads
      ?.filter((payload) => !payload.isError && !payload.isReasoning)
      .map((payload) => normalizeEscalationReplyText(payload.text))
      .filter(Boolean) ?? [];
  if (visibleTexts.length === 0) {
    return true;
  }
  return visibleTexts.every((text) => text === params.marker);
}

function resolveStageLiveModelSelectionOverride(params: {
  run: FollowupRun["run"];
  sessionKey?: string;
  provider: string;
  model: string;
}): {
  provider: string;
  model: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
} | null {
  const nextSelection = resolvePersistedLiveSessionModelSelection({
    cfg: params.run.config,
    sessionKey: params.sessionKey ?? params.run.sessionKey,
    agentId: params.run.agentId,
    defaultProvider: params.provider,
    defaultModel: params.model,
  });
  if (!nextSelection) {
    return null;
  }
  if (nextSelection.provider === params.provider && nextSelection.model === params.model) {
    return null;
  }
  return nextSelection;
}

function applyLiveSelectionToRun(
  run: FollowupRun["run"],
  selection: {
    provider: string;
    model: string;
    authProfileId?: string;
    authProfileIdSource?: "auto" | "user";
  },
): void {
  run.provider = selection.provider;
  run.model = selection.model;
  run.authProfileId = selection.authProfileId;
  run.authProfileIdSource = selection.authProfileId ? selection.authProfileIdSource : undefined;
}

function resolveEscalationPlanForLiveSelection(params: {
  plan: EmbeddedRunStagePlan;
  liveSelection?: {
    provider: string;
    model: string;
    authProfileId?: string;
    authProfileIdSource?: "auto" | "user";
  } | null;
}): EmbeddedRunStagePlan {
  if (!params.liveSelection) {
    return params.plan;
  }
  if (
    params.plan.provider === params.liveSelection.provider &&
    params.plan.model === params.liveSelection.model
  ) {
    return params.plan;
  }
  return {
    ...params.plan,
    provider: params.liveSelection.provider,
    model: params.liveSelection.model,
    explicitModel: true,
  };
}

async function captureSessionFileSnapshot(sessionFile: string): Promise<SessionFileSnapshot> {
  try {
    return {
      exists: true,
      contents: await fs.promises.readFile(sessionFile, "utf8"),
    };
  } catch {
    return { exists: false };
  }
}

async function restoreSessionFileSnapshot(
  sessionFile: string,
  snapshot: SessionFileSnapshot,
): Promise<void> {
  if (!snapshot.exists) {
    await fs.promises.rm(sessionFile, { force: true }).catch(() => {});
    return;
  }
  await fs.promises.writeFile(sessionFile, snapshot.contents ?? "", "utf8");
}

export async function runAgentTurnWithFallback(params: {
  commandBody: string;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  typingSignals: TypingSignaler;
  blockReplyPipeline: BlockReplyPipeline | null;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  applyReplyToMode: (payload: ReplyPayload) => ReplyPayload;
  shouldEmitToolResult: () => boolean;
  shouldEmitToolOutput: () => boolean;
  pendingToolTasks: Set<Promise<void>>;
  resetSessionAfterCompactionFailure: (reason: string) => Promise<boolean>;
  resetSessionAfterRoleOrderingConflict: (reason: string) => Promise<boolean>;
  isHeartbeat: boolean;
  sessionKey?: string;
  getActiveSessionEntry: () => SessionEntry | undefined;
  activeSessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  resolvedVerboseLevel: VerboseLevel;
}): Promise<AgentRunLoopResult> {
  const TRANSIENT_HTTP_RETRY_DELAY_MS = 2_500;
  let didLogHeartbeatStrip = false;
  let autoCompactionCount = 0;
  // Track payloads sent directly (not via pipeline) during tool flush to avoid duplicates.
  const directlySentBlockKeys = new Set<string>();

  const runId = params.opts?.runId ?? crypto.randomUUID();
  const normalizeReplyMediaPaths = createReplyMediaPathNormalizer({
    cfg: params.followupRun.run.config,
    sessionKey: params.sessionKey,
    workspaceDir: params.followupRun.run.workspaceDir,
  });
  let didNotifyAgentRunStart = false;
  const notifyAgentRunStart = () => {
    if (didNotifyAgentRunStart) {
      return;
    }
    didNotifyAgentRunStart = true;
    params.opts?.onAgentRunStart?.(runId);
  };
  const shouldSurfaceToControlUi = isInternalMessageChannel(
    params.followupRun.run.messageProvider ??
      params.sessionCtx.Surface ??
      params.sessionCtx.Provider,
  );
  if (params.sessionKey) {
    registerAgentRunContext(runId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
      isHeartbeat: params.isHeartbeat,
      isControlUiVisible: shouldSurfaceToControlUi,
    });
  }
  let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
  let fallbackProvider = params.followupRun.run.provider;
  let fallbackModel = params.followupRun.run.model;
  let fallbackAttempts: RuntimeFallbackAttempt[] = [];
  let didResetAfterCompactionFailure = false;
  let didRetryTransientHttpError = false;
  let bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
    params.getActiveSessionEntry()?.systemPromptReport,
  );

  while (true) {
    try {
      const normalizeStreamingText = (payload: ReplyPayload): { text?: string; skip: boolean } => {
        let text = payload.text;
        const reply = resolveSendableOutboundReplyParts(payload);
        if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
          const stripped = stripHeartbeatToken(text, {
            mode: "message",
          });
          if (stripped.didStrip && !didLogHeartbeatStrip) {
            didLogHeartbeatStrip = true;
            logVerbose("Stripped stray HEARTBEAT_OK token from reply");
          }
          if (stripped.shouldSkip && !reply.hasMedia) {
            return { skip: true };
          }
          text = stripped.text;
        }
        if (isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
          return { skip: true };
        }
        if (
          isSilentReplyPrefixText(text, SILENT_REPLY_TOKEN) ||
          isSilentReplyPrefixText(text, HEARTBEAT_TOKEN)
        ) {
          return { skip: true };
        }
        if (!text) {
          // Allow media-only payloads (e.g. tool result screenshots) through.
          if (reply.hasMedia) {
            return { text: undefined, skip: false };
          }
          return { skip: true };
        }
        const sanitized = sanitizeUserFacingText(text, {
          errorContext: Boolean(payload.isError),
        });
        if (!sanitized.trim()) {
          return { skip: true };
        }
        return { text: sanitized, skip: false };
      };
      const handlePartialForTyping = async (payload: ReplyPayload): Promise<string | undefined> => {
        if (isSilentReplyPrefixText(payload.text, SILENT_REPLY_TOKEN)) {
          return undefined;
        }
        const { text, skip } = normalizeStreamingText(payload);
        if (skip || !text) {
          return undefined;
        }
        await params.typingSignals.signalTextDelta(text);
        return text;
      };
      const blockReplyPipeline = params.blockReplyPipeline;
      // Build the delivery handler once so both onAgentEvent (compaction start
      // notice) and the onBlockReply field share the same instance.  This
      // ensures replyToId threading (replyToMode=all|first) is applied to
      // compaction notices just like every other block reply.
      const blockReplyHandler = params.opts?.onBlockReply
        ? createBlockReplyDeliveryHandler({
            onBlockReply: params.opts.onBlockReply,
            currentMessageId: params.sessionCtx.MessageSidFull ?? params.sessionCtx.MessageSid,
            normalizeStreamingText,
            applyReplyToMode: params.applyReplyToMode,
            normalizeMediaPaths: normalizeReplyMediaPaths,
            typingSignals: params.typingSignals,
            blockStreamingEnabled: params.blockStreamingEnabled,
            blockReplyPipeline,
            directlySentBlockKeys,
          })
        : undefined;
      const onToolResult = params.opts?.onToolResult;
      const multiStagePlan = resolveMultiStageRoutingPlan({
        run: params.followupRun.run,
        hasImages: Boolean(params.opts?.images?.length),
        isHeartbeat: params.isHeartbeat,
      });

      const executeStage = async (stageParams: {
        runId: string;
        visible: boolean;
        plan?: EmbeddedRunStagePlan;
      }) => {
        const effectivePlan = stageParams.plan;
        const stageName = stageParams.visible ? "escalation-pass" : "fast-pass";
        const effectiveThinkLevel = effectivePlan?.thinkLevel ?? params.followupRun.run.thinkLevel;
        const effectiveFastMode = effectivePlan?.fastMode ?? params.followupRun.run.fastMode;
        const effectiveReasoningLevel =
          effectivePlan?.reasoningLevel ?? params.followupRun.run.reasoningLevel;
        const inheritRunExtraSystemPrompt = effectivePlan?.inheritExtraSystemPrompt ?? true;
        const effectiveExtraSystemPrompt = [
          inheritRunExtraSystemPrompt ? params.followupRun.run.extraSystemPrompt : undefined,
          effectivePlan?.extraSystemPrompt,
        ]
          .map((value) => value?.trim())
          .filter(Boolean)
          .join("\n\n");
        let stageBootstrapPromptWarningSignaturesSeen = [...bootstrapPromptWarningSignaturesSeen];
        let stageAutoCompactionCount = 0;
        const stageStartedAt = Date.now();

        if (effectivePlan) {
          multiStageLog.info(`${stageName}: start`, {
            sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
            provider: effectivePlan.provider,
            model: effectivePlan.model,
            thinkLevel: effectiveThinkLevel,
            fastMode: effectiveFastMode,
            reasoningLevel: effectiveReasoningLevel,
            systemPromptMode: effectivePlan.systemPromptMode ?? "default",
            skillsPromptMode: effectivePlan.skillsPromptMode ?? "default",
            bootstrapContextMode:
              effectivePlan.bootstrapContextMode ?? params.opts?.bootstrapContextMode ?? "default",
            disableTools: effectivePlan.disableTools ?? false,
            inheritExtraSystemPrompt: inheritRunExtraSystemPrompt,
            extraSystemPromptChars: effectiveExtraSystemPrompt.length,
            commandChars: params.commandBody.length,
          });
        }

        try {
          const fallbackResult = await runWithModelFallback<
            Awaited<ReturnType<typeof runEmbeddedPiAgent>>
          >({
            ...(effectivePlan?.explicitModel
              ? {
                  cfg: params.followupRun.run.config,
                  provider: effectivePlan.provider,
                  model: effectivePlan.model,
                  agentDir: params.followupRun.run.agentDir,
                  fallbacksOverride: [],
                }
              : resolveModelFallbackOptions(params.followupRun.run)),
            runId: stageParams.runId,
            run: (provider, model, runOptions) => {
              if (isCliProvider(provider, params.followupRun.run.config)) {
                const startedAt = Date.now();
                notifyAgentRunStart();
                emitAgentEvent({
                  runId: stageParams.runId,
                  stream: "lifecycle",
                  data: {
                    phase: "start",
                    startedAt,
                  },
                });
                const cliSessionBinding = getCliSessionBinding(
                  params.getActiveSessionEntry(),
                  provider,
                );
                const authProfileId =
                  provider === params.followupRun.run.provider
                    ? params.followupRun.run.authProfileId
                    : undefined;
                return (async () => {
                  let lifecycleTerminalEmitted = false;
                  try {
                    const result = await runCliAgent({
                      sessionId: params.followupRun.run.sessionId,
                      sessionKey: params.sessionKey,
                      agentId: params.followupRun.run.agentId,
                      sessionFile: params.followupRun.run.sessionFile,
                      workspaceDir: params.followupRun.run.workspaceDir,
                      config: params.followupRun.run.config,
                      prompt: params.commandBody,
                      provider,
                      model,
                      thinkLevel: effectiveThinkLevel,
                      timeoutMs: params.followupRun.run.timeoutMs,
                      runId: stageParams.runId,
                      extraSystemPrompt: effectiveExtraSystemPrompt || undefined,
                      systemPromptMode: effectivePlan?.systemPromptMode,
                      bootstrapContextMode:
                        effectivePlan?.bootstrapContextMode ?? params.opts?.bootstrapContextMode,
                      ownerNumbers: params.followupRun.run.ownerNumbers,
                      cliSessionId: cliSessionBinding?.sessionId,
                      cliSessionBinding,
                      authProfileId,
                      bootstrapPromptWarningSignaturesSeen:
                        stageBootstrapPromptWarningSignaturesSeen,
                      bootstrapPromptWarningSignature:
                        stageBootstrapPromptWarningSignaturesSeen[
                          stageBootstrapPromptWarningSignaturesSeen.length - 1
                        ],
                      images: params.opts?.images,
                    });
                    stageBootstrapPromptWarningSignaturesSeen =
                      resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport);

                    const cliText = result.payloads?.[0]?.text?.trim();
                    if (cliText) {
                      emitAgentEvent({
                        runId: stageParams.runId,
                        stream: "assistant",
                        data: { text: cliText },
                      });
                    }

                    emitAgentEvent({
                      runId: stageParams.runId,
                      stream: "lifecycle",
                      data: {
                        phase: "end",
                        startedAt,
                        endedAt: Date.now(),
                      },
                    });
                    lifecycleTerminalEmitted = true;

                    return result;
                  } catch (err) {
                    emitAgentEvent({
                      runId: stageParams.runId,
                      stream: "lifecycle",
                      data: {
                        phase: "error",
                        startedAt,
                        endedAt: Date.now(),
                        error: String(err),
                      },
                    });
                    lifecycleTerminalEmitted = true;
                    throw err;
                  } finally {
                    if (!lifecycleTerminalEmitted) {
                      emitAgentEvent({
                        runId: stageParams.runId,
                        stream: "lifecycle",
                        data: {
                          phase: "error",
                          startedAt,
                          endedAt: Date.now(),
                          error: "CLI run completed without lifecycle terminal event",
                        },
                      });
                    }
                  }
                })();
              }
              const { embeddedContext, senderContext, runBaseParams } =
                buildEmbeddedRunExecutionParams({
                  run: params.followupRun.run,
                  sessionCtx: params.sessionCtx,
                  hasRepliedRef: params.opts?.hasRepliedRef,
                  provider,
                  runId: stageParams.runId,
                  allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
                  model,
                });
              return (async () => {
                let attemptCompactionCount = 0;
                try {
                  const result = await runEmbeddedPiAgent({
                    ...embeddedContext,
                    allowGatewaySubagentBinding: true,
                    trigger: params.isHeartbeat ? "heartbeat" : "user",
                    groupId: resolveGroupSessionKey(params.sessionCtx)?.id,
                    groupChannel:
                      params.sessionCtx.GroupChannel?.trim() ??
                      params.sessionCtx.GroupSubject?.trim(),
                    groupSpace: params.sessionCtx.GroupSpace?.trim() ?? undefined,
                    ...senderContext,
                    ...runBaseParams,
                    thinkLevel: effectiveThinkLevel,
                    fastMode: effectiveFastMode,
                    reasoningLevel: effectiveReasoningLevel,
                    prompt: params.commandBody,
                    extraSystemPrompt: effectiveExtraSystemPrompt || undefined,
                    systemPromptMode: effectivePlan?.systemPromptMode,
                    skillsPromptMode: effectivePlan?.skillsPromptMode,
                    disableTools: effectivePlan?.disableTools,
                    toolResultFormat: (() => {
                      const channel = resolveMessageChannel(
                        params.sessionCtx.Surface,
                        params.sessionCtx.Provider,
                      );
                      if (!channel) {
                        return "markdown";
                      }
                      return isMarkdownCapableMessageChannel(channel) ? "markdown" : "plain";
                    })(),
                    suppressToolErrorWarnings: params.opts?.suppressToolErrorWarnings,
                    bootstrapContextMode:
                      effectivePlan?.bootstrapContextMode ?? params.opts?.bootstrapContextMode,
                    bootstrapContextRunKind: params.opts?.isHeartbeat ? "heartbeat" : "default",
                    images: params.opts?.images,
                    abortSignal: params.opts?.abortSignal,
                    blockReplyBreak: params.resolvedBlockStreamingBreak,
                    blockReplyChunking: params.blockReplyChunking,
                    onPartialReply: stageParams.visible
                      ? async (payload) => {
                          const textForTyping = await handlePartialForTyping(payload);
                          if (!params.opts?.onPartialReply || textForTyping === undefined) {
                            return;
                          }
                          await params.opts.onPartialReply({
                            text: textForTyping,
                            mediaUrls: payload.mediaUrls,
                          });
                        }
                      : undefined,
                    onAssistantMessageStart: stageParams.visible
                      ? async () => {
                          await params.typingSignals.signalMessageStart();
                          await params.opts?.onAssistantMessageStart?.();
                        }
                      : undefined,
                    onReasoningStream:
                      stageParams.visible &&
                      (params.typingSignals.shouldStartOnReasoning ||
                        params.opts?.onReasoningStream)
                        ? async (payload) => {
                            await params.typingSignals.signalReasoningDelta();
                            await params.opts?.onReasoningStream?.({
                              text: payload.text,
                              mediaUrls: payload.mediaUrls,
                            });
                          }
                        : undefined,
                    onReasoningEnd: stageParams.visible ? params.opts?.onReasoningEnd : undefined,
                    onAgentEvent: async (evt) => {
                      const hasLifecyclePhase =
                        evt.stream === "lifecycle" && typeof evt.data.phase === "string";
                      if (evt.stream !== "lifecycle" || hasLifecyclePhase) {
                        notifyAgentRunStart();
                      }
                      if (evt.stream === "compaction") {
                        const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                        const completed = evt.data?.completed === true;
                        if (!stageParams.visible) {
                          if (phase === "end" && completed) {
                            attemptCompactionCount += 1;
                          }
                          return;
                        }
                        if (phase === "start") {
                          if (params.opts?.onCompactionStart) {
                            await params.opts.onCompactionStart();
                          } else if (params.opts?.onBlockReply) {
                            const currentMessageId =
                              params.sessionCtx.MessageSidFull ?? params.sessionCtx.MessageSid;
                            const noticePayload = params.applyReplyToMode({
                              text: "🧹 Compacting context...",
                              replyToId: currentMessageId,
                              replyToCurrent: true,
                              isCompactionNotice: true,
                            });
                            try {
                              await params.opts.onBlockReply(noticePayload);
                            } catch (err) {
                              logVerbose(
                                `compaction start notice delivery failed (non-fatal): ${String(err)}`,
                              );
                            }
                          }
                        }
                        if (phase === "end" && completed) {
                          attemptCompactionCount += 1;
                          await params.opts?.onCompactionEnd?.();
                        }
                        return;
                      }
                      if (!stageParams.visible || evt.stream !== "tool") {
                        return;
                      }
                      const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                      const name = typeof evt.data.name === "string" ? evt.data.name : undefined;
                      if (phase === "start" || phase === "update") {
                        await params.typingSignals.signalToolStart();
                        await params.opts?.onToolStart?.({ name, phase });
                      }
                    },
                    onBlockReply: stageParams.visible ? blockReplyHandler : undefined,
                    onBlockReplyFlush:
                      stageParams.visible && params.blockStreamingEnabled && blockReplyPipeline
                        ? async () => {
                            await blockReplyPipeline.flush({ force: true });
                          }
                        : undefined,
                    shouldEmitToolResult: params.shouldEmitToolResult,
                    shouldEmitToolOutput: params.shouldEmitToolOutput,
                    bootstrapPromptWarningSignaturesSeen: stageBootstrapPromptWarningSignaturesSeen,
                    bootstrapPromptWarningSignature:
                      stageBootstrapPromptWarningSignaturesSeen[
                        stageBootstrapPromptWarningSignaturesSeen.length - 1
                      ],
                    onToolResult:
                      stageParams.visible && onToolResult
                        ? (() => {
                            let toolResultChain: Promise<void> = Promise.resolve();
                            return (payload: ReplyPayload) => {
                              toolResultChain = toolResultChain
                                .then(async () => {
                                  const { text, skip } = normalizeStreamingText(payload);
                                  if (skip) {
                                    return;
                                  }
                                  if (text !== undefined) {
                                    await params.typingSignals.signalTextDelta(text);
                                  }
                                  await onToolResult({
                                    ...payload,
                                    text,
                                  });
                                })
                                .catch((err) => {
                                  logVerbose(`tool result delivery failed: ${String(err)}`);
                                });
                              const task = toolResultChain.finally(() => {
                                params.pendingToolTasks.delete(task);
                              });
                              params.pendingToolTasks.add(task);
                            };
                          })()
                        : undefined,
                  });
                  stageBootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
                    result.meta?.systemPromptReport,
                  );
                  const resultCompactionCount = Math.max(
                    0,
                    result.meta?.agentMeta?.compactionCount ?? 0,
                  );
                  attemptCompactionCount = Math.max(attemptCompactionCount, resultCompactionCount);
                  return result;
                } finally {
                  stageAutoCompactionCount += attemptCompactionCount;
                }
              })();
            },
          });
          const durationMs = Date.now() - stageStartedAt;
          if (effectivePlan) {
            multiStageLog.info(`${stageName}: completed`, {
              sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
              provider: fallbackResult.provider,
              model: fallbackResult.model,
              durationMs,
              fallbackAttempts: fallbackResult.attempts.length,
              autoCompactionCount: stageAutoCompactionCount,
            });
          }

          return {
            fallbackResult,
            stageBootstrapPromptWarningSignaturesSeen,
            stageAutoCompactionCount,
            thinkLevel: effectiveThinkLevel,
            durationMs,
          };
        } catch (err) {
          if (effectivePlan) {
            multiStageLog.warn(`${stageName}: failed`, {
              sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
              provider: effectivePlan.provider,
              model: effectivePlan.model,
              durationMs: Date.now() - stageStartedAt,
              error: String(err),
            });
          }
          throw err;
        }
      };

      const commitStageResult = (stageResult: Awaited<ReturnType<typeof executeStage>>) => {
        runResult = stageResult.fallbackResult.result;
        fallbackProvider = stageResult.fallbackResult.provider;
        fallbackModel = stageResult.fallbackResult.model;
        fallbackAttempts = Array.isArray(stageResult.fallbackResult.attempts)
          ? stageResult.fallbackResult.attempts.map((attempt) => ({
              provider: String(attempt.provider ?? ""),
              model: String(attempt.model ?? ""),
              error: String(attempt.error ?? ""),
              reason: attempt.reason ? String(attempt.reason) : undefined,
              status: typeof attempt.status === "number" ? attempt.status : undefined,
              code: attempt.code ? String(attempt.code) : undefined,
            }))
          : [];
        bootstrapPromptWarningSignaturesSeen =
          stageResult.stageBootstrapPromptWarningSignaturesSeen;
        autoCompactionCount += stageResult.stageAutoCompactionCount;
        params.opts?.onModelSelected?.({
          provider: stageResult.fallbackResult.provider,
          model: stageResult.fallbackResult.model,
          thinkLevel: stageResult.thinkLevel,
        });
      };

      if (multiStagePlan) {
        const fastPassLiveSelection = resolveStageLiveModelSelectionOverride({
          run: params.followupRun.run,
          sessionKey: params.sessionKey,
          provider: multiStagePlan.fastPass.provider,
          model: multiStagePlan.fastPass.model,
        });
        if (fastPassLiveSelection) {
          applyLiveSelectionToRun(params.followupRun.run, fastPassLiveSelection);
          const escalationPlan = resolveEscalationPlanForLiveSelection({
            plan: multiStagePlan.escalationPass,
            liveSelection: fastPassLiveSelection,
          });
          multiStageLog.warn("fast-pass: skipped due to live session switch", {
            sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
            fastPassProvider: multiStagePlan.fastPass.provider,
            fastPassModel: multiStagePlan.fastPass.model,
            liveProvider: fastPassLiveSelection.provider,
            liveModel: fastPassLiveSelection.model,
            escalationProvider: escalationPlan.provider,
            escalationModel: escalationPlan.model,
          });
          const escalationResult = await executeStage({
            runId,
            visible: true,
            plan: escalationPlan,
          });
          multiStageLog.info("escalation-pass: accepted", {
            sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
            provider: escalationResult.fallbackResult.provider,
            model: escalationResult.fallbackResult.model,
            durationMs: escalationResult.durationMs,
          });
          commitStageResult(escalationResult);
        } else {
          const sessionFileSnapshot = await captureSessionFileSnapshot(
            params.followupRun.run.sessionFile,
          );
          const bootstrapSignaturesBeforeFastPass = [...bootstrapPromptWarningSignaturesSeen];
          try {
            const fastPassResult = await executeStage({
              runId: `${runId}:fast-pass`,
              visible: false,
              plan: multiStagePlan.fastPass,
            });
            if (
              !shouldEscalateStageResult({
                runResult: fastPassResult.fallbackResult.result,
                marker: multiStagePlan.escalationMarker,
              })
            ) {
              multiStageLog.info("fast-pass: accepted", {
                sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
                provider: fastPassResult.fallbackResult.provider,
                model: fastPassResult.fallbackResult.model,
                durationMs: fastPassResult.durationMs,
              });
              commitStageResult(fastPassResult);
            } else {
              multiStageLog.info("fast-pass: escalating", {
                sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
                provider: fastPassResult.fallbackResult.provider,
                model: fastPassResult.fallbackResult.model,
                durationMs: fastPassResult.durationMs,
                reason: "marker_or_empty_visible_reply",
              });
              await restoreSessionFileSnapshot(
                params.followupRun.run.sessionFile,
                sessionFileSnapshot,
              );
              bootstrapPromptWarningSignaturesSeen = bootstrapSignaturesBeforeFastPass;

              const escalationResult = await executeStage({
                runId,
                visible: true,
                plan: multiStagePlan.escalationPass,
              });
              multiStageLog.info("escalation-pass: accepted", {
                sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
                provider: escalationResult.fallbackResult.provider,
                model: escalationResult.fallbackResult.model,
                durationMs: escalationResult.durationMs,
              });
              commitStageResult(escalationResult);
            }
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
              throw err;
            }
            let liveSelectionOverride: {
              provider: string;
              model: string;
              authProfileId?: string;
              authProfileIdSource?: "auto" | "user";
            } | null = null;
            if (err instanceof LiveSessionModelSwitchError) {
              liveSelectionOverride = {
                provider: err.provider,
                model: err.model,
                authProfileId: err.authProfileId,
                authProfileIdSource: err.authProfileIdSource,
              };
              applyLiveSelectionToRun(params.followupRun.run, liveSelectionOverride);
              fallbackProvider = err.provider;
              fallbackModel = err.model;
              multiStageLog.warn("fast-pass: escalating after live session switch", {
                sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
                provider: err.provider,
                model: err.model,
              });
            } else {
              logVerbose(`fast-pass stage failed, escalating: ${String(err)}`);
              multiStageLog.warn("fast-pass: escalating after error", {
                sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
                error: String(err),
              });
            }
            await restoreSessionFileSnapshot(
              params.followupRun.run.sessionFile,
              sessionFileSnapshot,
            );
            bootstrapPromptWarningSignaturesSeen = bootstrapSignaturesBeforeFastPass;
            const escalationPlan = resolveEscalationPlanForLiveSelection({
              plan: multiStagePlan.escalationPass,
              liveSelection: liveSelectionOverride,
            });
            const escalationResult = await executeStage({
              runId,
              visible: true,
              plan: escalationPlan,
            });
            multiStageLog.info("escalation-pass: accepted", {
              sessionKey: params.sessionKey ?? params.followupRun.run.sessionId,
              provider: escalationResult.fallbackResult.provider,
              model: escalationResult.fallbackResult.model,
              durationMs: escalationResult.durationMs,
            });
            commitStageResult(escalationResult);
          }
        }
      } else {
        const fallbackResult = await executeStage({
          runId,
          visible: true,
        });
        commitStageResult(fallbackResult);
      }

      // Some embedded runs surface context overflow as an error payload instead of throwing.
      // Treat those as a session-level failure and auto-recover by starting a fresh session.
      const embeddedError = runResult.meta?.error;
      if (
        embeddedError &&
        isContextOverflowError(embeddedError.message) &&
        !didResetAfterCompactionFailure &&
        (await params.resetSessionAfterCompactionFailure(embeddedError.message))
      ) {
        didResetAfterCompactionFailure = true;
        return {
          kind: "final",
          payload: {
            text: "⚠️ Context limit exceeded. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
          },
        };
      }
      if (embeddedError?.kind === "role_ordering") {
        const didReset = await params.resetSessionAfterRoleOrderingConflict(embeddedError.message);
        if (didReset) {
          return {
            kind: "final",
            payload: {
              text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
            },
          };
        }
      }

      break;
    } catch (err) {
      if (err instanceof LiveSessionModelSwitchError) {
        params.followupRun.run.provider = err.provider;
        params.followupRun.run.model = err.model;
        params.followupRun.run.authProfileId = err.authProfileId;
        params.followupRun.run.authProfileIdSource = err.authProfileId
          ? err.authProfileIdSource
          : undefined;
        fallbackProvider = err.provider;
        fallbackModel = err.model;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      const isBilling = isBillingErrorMessage(message);
      const isContextOverflow = !isBilling && isLikelyContextOverflowError(message);
      const isCompactionFailure = !isBilling && isCompactionFailureError(message);
      const isSessionCorruption = /function call turn comes immediately after/i.test(message);
      const isRoleOrderingError = /incorrect role information|roles must alternate/i.test(message);
      const isTransientHttp = isTransientHttpError(message);

      if (
        isCompactionFailure &&
        !didResetAfterCompactionFailure &&
        (await params.resetSessionAfterCompactionFailure(message))
      ) {
        didResetAfterCompactionFailure = true;
        return {
          kind: "final",
          payload: {
            text: "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\n\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
          },
        };
      }
      if (isRoleOrderingError) {
        const didReset = await params.resetSessionAfterRoleOrderingConflict(message);
        if (didReset) {
          return {
            kind: "final",
            payload: {
              text: "⚠️ Message ordering conflict. I've reset the conversation - please try again.",
            },
          };
        }
      }

      // Auto-recover from Gemini session corruption by resetting the session
      if (
        isSessionCorruption &&
        params.sessionKey &&
        params.activeSessionStore &&
        params.storePath
      ) {
        const sessionKey = params.sessionKey;
        const corruptedSessionId = params.getActiveSessionEntry()?.sessionId;
        defaultRuntime.error(
          `Session history corrupted (Gemini function call ordering). Resetting session: ${params.sessionKey}`,
        );

        try {
          // Delete transcript file if it exists
          if (corruptedSessionId) {
            const transcriptPath = resolveSessionTranscriptPath(corruptedSessionId);
            try {
              fs.unlinkSync(transcriptPath);
            } catch {
              // Ignore if file doesn't exist
            }
          }

          // Keep the in-memory snapshot consistent with the on-disk store reset.
          delete params.activeSessionStore[sessionKey];

          // Remove session entry from store using a fresh, locked snapshot.
          await updateSessionStore(params.storePath, (store) => {
            delete store[sessionKey];
          });
        } catch (cleanupErr) {
          defaultRuntime.error(
            `Failed to reset corrupted session ${params.sessionKey}: ${String(cleanupErr)}`,
          );
        }

        return {
          kind: "final",
          payload: {
            text: "⚠️ Session history was corrupted. I've reset the conversation - please try again!",
          },
        };
      }

      if (isTransientHttp && !didRetryTransientHttpError) {
        didRetryTransientHttpError = true;
        // Retry the full runWithModelFallback() cycle — transient errors
        // (502/521/etc.) typically affect the whole provider, so falling
        // back to an alternate model first would not help. Instead we wait
        // and retry the complete primary→fallback chain.
        defaultRuntime.error(
          `Transient HTTP provider error before reply (${message}). Retrying once in ${TRANSIENT_HTTP_RETRY_DELAY_MS}ms.`,
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, TRANSIENT_HTTP_RETRY_DELAY_MS);
        });
        continue;
      }

      defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
      // Only classify as rate-limit when we have concrete evidence from the
      // underlying error. FallbackSummaryError messages embed per-attempt
      // reason labels like `(rate_limit)`, so string-matching the summary text
      // would misclassify mixed-cause exhaustion as a pure transient cooldown.
      const isRateLimit = isFallbackSummaryError(err)
        ? isPureTransientRateLimitSummary(err)
        : isRateLimitErrorMessage(message);
      const safeMessage = isTransientHttp
        ? sanitizeUserFacingText(message, { errorContext: true })
        : message;
      const trimmedMessage = safeMessage.replace(/\.\s*$/, "");
      const fallbackText = isBilling
        ? BILLING_ERROR_USER_MESSAGE
        : isRateLimit
          ? buildRateLimitCooldownMessage(err)
          : isContextOverflow
            ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model."
            : isRoleOrderingError
              ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session."
              : `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openclaw logs --follow`;

      return {
        kind: "final",
        payload: {
          text: fallbackText,
        },
      };
    }
  }

  // If the run completed but with an embedded context overflow error that
  // wasn't recovered from (e.g. compaction reset already attempted), surface
  // the error to the user instead of silently returning an empty response.
  // See #26905: Slack DM sessions silently swallowed messages when context
  // overflow errors were returned as embedded error payloads.
  const finalEmbeddedError = runResult?.meta?.error;
  const hasPayloadText = runResult?.payloads?.some((p) => p.text?.trim());
  if (finalEmbeddedError && !hasPayloadText) {
    const errorMsg = finalEmbeddedError.message ?? "";
    if (isContextOverflowError(errorMsg)) {
      return {
        kind: "final",
        payload: {
          text: "⚠️ Context overflow — this conversation is too large for the model. Use /new to start a fresh session.",
        },
      };
    }
  }

  // Surface rate limit and overload errors that occur mid-turn (after tool
  // calls) instead of silently returning an empty response. See #36142.
  // Only applies when the assistant produced no valid (non-error) reply text,
  // so tool-level rate-limit messages don't override a successful turn.
  // Prioritize metaErrorMsg (raw upstream error) over errorPayloadText to
  // avoid self-matching on pre-formatted "⚠️" messages from run.ts, and
  // skip already-formatted payloads so tool-specific 429 errors (e.g.
  // browser/search tool failures) are preserved rather than overwritten.
  //
  // Instead of early-returning kind:"final" (which would bypass
  // buildReplyPayloads() filtering and session bookkeeping), inject the
  // error payload into runResult so it flows through the normal
  // kind:"success" path — preserving streaming dedup, message_send
  // suppression, and usage/model metadata updates.
  if (runResult) {
    const hasNonErrorContent = runResult.payloads?.some(
      (p) => !p.isError && !p.isReasoning && hasOutboundReplyContent(p, { trimText: true }),
    );
    if (!hasNonErrorContent) {
      const metaErrorMsg = finalEmbeddedError?.message ?? "";
      const rawErrorPayloadText =
        runResult.payloads?.find((p) => p.isError && p.text?.trim() && !p.text.startsWith("⚠️"))
          ?.text ?? "";
      const errorCandidate = metaErrorMsg || rawErrorPayloadText;
      if (
        errorCandidate &&
        (isRateLimitErrorMessage(errorCandidate) || isOverloadedErrorMessage(errorCandidate))
      ) {
        runResult.payloads = [
          {
            text: "⚠️ API rate limit reached — the model couldn't generate a response. Please try again in a moment.",
            isError: true,
          },
        ];
      }
    }
  }

  return {
    kind: "success",
    runId,
    runResult,
    fallbackProvider,
    fallbackModel,
    fallbackAttempts,
    didLogHeartbeatStrip,
    autoCompactionCount,
    directlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : undefined,
  };
}
