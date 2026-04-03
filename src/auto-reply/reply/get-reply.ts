import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveSessionAgentId,
  resolveAgentSkillsFilter,
} from "../../agents/agent-scope.js";
import { resolveModelRefFromString } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../../agents/workspace.js";
import { resolveChannelModelOverride } from "../../channels/model-overrides.js";
import { type OpenClawConfig, loadConfig } from "../../config/config.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeStringEntries } from "../../shared/string-normalization.js";
import { resolveCommandAuthorization } from "../command-auth.js";
import type { MsgContext } from "../templating.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { resolveDefaultModel } from "./directive-handling.defaults.js";
import { resolveReplyDirectives } from "./get-reply-directives.js";
import { handleInlineActions } from "./get-reply-inline-actions.js";
import { runPreparedReply } from "./get-reply-run.js";
import { finalizeInboundContext } from "./inbound-context.js";
import { emitPreAgentMessageHooks } from "./message-preprocess-hooks.js";
import { initSessionState } from "./session.js";
import { createTypingController } from "./typing.js";

type ResetCommandAction = "new" | "reset";

let sessionResetModelRuntimePromise: Promise<
  typeof import("./session-reset-model.runtime.js")
> | null = null;
let stageSandboxMediaRuntimePromise: Promise<
  typeof import("./stage-sandbox-media.runtime.js")
> | null = null;
let bundledSkillFastpassRuntimePromise: Promise<
  typeof import("./bundled-skill-fastpass.runtime.js")
> | null = null;

const REQUIRED_SCHEDULE_NOUN_RE =
  /(?:日程|日历|行程|安排|会议|约会|提醒|待办|计划|calendar|schedule|meeting|event|agenda|todo|reminder)/i;
const REQUIRED_SCHEDULE_ACTION_RE =
  /(?:添加|新增|安排|创建|记下|记个|提醒我|查询|查看|看下|看看|显示|列出|编辑|修改|更新|删除|取消|完成|发我|告诉我|生成图|生成图片|图片|文字总结|总结版|汇总版|add|create|schedule|show|list|view|edit|update|delete|remove|cancel|complete|render|image|summary)/i;
const REQUIRED_SCHEDULE_EVENT_RE =
  /(?:(?:今天|明天|后天|大后天|今晚|今早|本周|这周|下周|本月|这个月|下个月|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|周[一二三四五六日天]).{0,32}(?:开会|会议|见面|约会|提醒|行程|日程|安排|review|meeting|event))/i;
const REQUIRED_FILE_NOUN_RE =
  /(?:\.(?:pdf|docx?|pptx|xlsx|csv|txt|md|markdown|html?|xml|json|eml|rtf|odt)\b|pdf|docx|word|pptx|powerpoint|xlsx|excel|csv|markdown|html|xml|json|文档|文件|合同|发票|表格|幻灯片|课件|简历)/i;
const REQUIRED_FILE_ACTION_RE =
  /(?:翻译|提取|抽取|转换|转成|导出|导入|整理|读取|打开|合并|拆分|分割|压缩|解压|ocr|识别|总结|摘要|改写|重写|编辑|比较|对比|查找|替换|生成|导出成|导出为|extract|convert|translate|summari[sz]e|rewrite|edit|compare|merge|split|ocr|read|open)/i;
const DOCUMENT_MEDIA_TYPE_RE =
  /^(?:application\/(?:pdf|msword|vnd\.(?:ms-excel|ms-powerpoint|openxmlformats-officedocument\.[^;]+)|rtf|json|xml|zip)|text\/|message\/rfc822)/i;
const DOCUMENT_MEDIA_EXT_RE =
  /\.(?:pdf|docx?|pptx|xlsx|csv|txt|md|markdown|html?|xml|json|eml|rtf|odt)(?:$|[?#])/i;

function shouldUseBundledSkillFastpass(
  ctx: Pick<MsgContext, "Provider" | "Surface" | "OriginatingChannel">,
): boolean {
  const channels = [ctx.Provider, ctx.Surface, ctx.OriginatingChannel]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  return channels.includes("cron-event");
}

function isWeixinDirectSkillContext(
  ctx: Pick<MsgContext, "Provider" | "Surface" | "OriginatingChannel" | "ChatType">,
): boolean {
  const channels = [ctx.Provider, ctx.Surface, ctx.OriginatingChannel]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  const chatType = ctx.ChatType?.trim().toLowerCase();
  return channels.includes("openclaw-weixin") && (!chatType || chatType === "direct");
}

function loadSessionResetModelRuntime() {
  sessionResetModelRuntimePromise ??= import("./session-reset-model.runtime.js");
  return sessionResetModelRuntimePromise;
}

function loadStageSandboxMediaRuntime() {
  stageSandboxMediaRuntimePromise ??= import("./stage-sandbox-media.runtime.js");
  return stageSandboxMediaRuntimePromise;
}

function loadBundledSkillFastpassRuntime() {
  bundledSkillFastpassRuntimePromise ??= import("./bundled-skill-fastpass.runtime.js");
  return bundledSkillFastpassRuntimePromise;
}

function mergeSkillFilters(channelFilter?: string[], agentFilter?: string[]): string[] | undefined {
  const normalize = (list?: string[]) => {
    if (!Array.isArray(list)) {
      return undefined;
    }
    return normalizeStringEntries(list);
  };
  const channel = normalize(channelFilter);
  const agent = normalize(agentFilter);
  if (!channel && !agent) {
    return undefined;
  }
  if (!channel) {
    return agent;
  }
  if (!agent) {
    return channel;
  }
  if (channel.length === 0 || agent.length === 0) {
    return [];
  }
  const agentSet = new Set(agent);
  return channel.filter((name) => agentSet.has(name));
}

function resolveSkillAwareMessageText(
  ctx: Pick<MsgContext, "BodyForCommands" | "CommandBody" | "RawBody" | "Body">,
): string {
  return (
    [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function hasDocumentLikeMedia(ctx: MsgContext): boolean {
  const types = [
    typeof ctx.MediaType === "string" ? ctx.MediaType : undefined,
    ...(Array.isArray(ctx.MediaTypes) ? ctx.MediaTypes : []),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean) as string[];
  if (types.some((value) => DOCUMENT_MEDIA_TYPE_RE.test(value))) {
    return true;
  }

  const paths = [
    typeof ctx.MediaPath === "string" ? ctx.MediaPath : undefined,
    ...(Array.isArray(ctx.MediaPaths) ? ctx.MediaPaths : []),
    typeof ctx.MediaUrl === "string" ? ctx.MediaUrl : undefined,
    ...(Array.isArray(ctx.MediaUrls) ? ctx.MediaUrls : []),
  ].filter(Boolean) as string[];
  return paths.some((value) => DOCUMENT_MEDIA_EXT_RE.test(value.toLowerCase()));
}

function resolveRequiredBundledSkills(ctx: MsgContext): string[] {
  const message = resolveSkillAwareMessageText(ctx);
  const required = new Set<string>();
  if (isWeixinDirectSkillContext(ctx)) {
    required.add("smart-calendar");
    required.add("document-processing-pipeline");
  }
  if (
    (REQUIRED_SCHEDULE_NOUN_RE.test(message) && REQUIRED_SCHEDULE_ACTION_RE.test(message)) ||
    REQUIRED_SCHEDULE_EVENT_RE.test(message)
  ) {
    required.add("smart-calendar");
  }
  if (
    (REQUIRED_FILE_NOUN_RE.test(message) && REQUIRED_FILE_ACTION_RE.test(message)) ||
    hasDocumentLikeMedia(ctx)
  ) {
    required.add("document-processing-pipeline");
  }
  return [...required];
}

function injectRequiredSkills(
  skillFilter: string[] | undefined,
  requiredSkills: string[],
): string[] | undefined {
  if (requiredSkills.length === 0) {
    return skillFilter;
  }
  if (skillFilter === undefined) {
    return requiredSkills;
  }
  const merged = new Set(skillFilter);
  for (const skill of requiredSkills) {
    merged.add(skill);
  }
  return [...merged];
}

function hasInboundMedia(ctx: MsgContext): boolean {
  return Boolean(
    ctx.StickerMediaIncluded ||
    ctx.Sticker ||
    ctx.MediaPath?.trim() ||
    ctx.MediaUrl?.trim() ||
    ctx.MediaPaths?.some((value) => value?.trim()) ||
    ctx.MediaUrls?.some((value) => value?.trim()) ||
    ctx.MediaTypes?.length,
  );
}

function hasLinkCandidate(ctx: MsgContext): boolean {
  const message = ctx.BodyForCommands ?? ctx.CommandBody ?? ctx.RawBody ?? ctx.Body;
  if (!message) {
    return false;
  }
  return /\bhttps?:\/\/\S+/i.test(message);
}

async function applyMediaUnderstandingIfNeeded(params: {
  ctx: MsgContext;
  cfg: OpenClawConfig;
  agentDir?: string;
  activeModel: { provider: string; model: string };
}): Promise<boolean> {
  if (!hasInboundMedia(params.ctx)) {
    return false;
  }
  const { applyMediaUnderstanding } = await import("../../media-understanding/apply.runtime.js");
  await applyMediaUnderstanding(params);
  return true;
}

async function applyLinkUnderstandingIfNeeded(params: {
  ctx: MsgContext;
  cfg: OpenClawConfig;
}): Promise<boolean> {
  if (!hasLinkCandidate(params.ctx)) {
    return false;
  }
  const { applyLinkUnderstanding } = await import("../../link-understanding/apply.runtime.js");
  await applyLinkUnderstanding(params);
  return true;
}

export async function getReplyFromConfig(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: OpenClawConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const isFastTestEnv = process.env.OPENCLAW_TEST_FAST === "1";
  const cfg =
    configOverride == null
      ? loadConfig()
      : (applyMergePatch(loadConfig(), configOverride) as OpenClawConfig);
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const agentSessionKey = targetSessionKey || ctx.SessionKey;
  const agentId = resolveSessionAgentId({
    sessionKey: agentSessionKey,
    config: cfg,
  });
  const finalized = finalizeInboundContext(ctx);
  const mergedSkillFilter = injectRequiredSkills(
    mergeSkillFilters(opts?.skillFilter, resolveAgentSkillsFilter(cfg, agentId)),
    resolveRequiredBundledSkills(finalized),
  );
  const resolvedOpts =
    mergedSkillFilter !== undefined ? { ...opts, skillFilter: mergedSkillFilter } : opts;
  const agentCfg = cfg.agents?.defaults;
  const sessionCfg = cfg.session;
  const { defaultProvider, defaultModel, aliasIndex } = resolveDefaultModel({
    cfg,
    agentId,
  });
  let provider = defaultProvider;
  let model = defaultModel;
  let hasResolvedHeartbeatModelOverride = false;
  if (opts?.isHeartbeat) {
    // Prefer the resolved per-agent heartbeat model passed from the heartbeat runner,
    // fall back to the global defaults heartbeat model for backward compatibility.
    const heartbeatRaw =
      opts.heartbeatModelOverride?.trim() ?? agentCfg?.heartbeat?.model?.trim() ?? "";
    const heartbeatRef = heartbeatRaw
      ? resolveModelRefFromString({
          raw: heartbeatRaw,
          defaultProvider,
          aliasIndex,
        })
      : null;
    if (heartbeatRef) {
      provider = heartbeatRef.ref.provider;
      model = heartbeatRef.ref.model;
      hasResolvedHeartbeatModelOverride = true;
    }
  }

  const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, agentId) ?? DEFAULT_AGENT_WORKSPACE_DIR;
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !agentCfg?.skipBootstrap && !isFastTestEnv,
  });
  const workspaceDir = workspace.dir;
  const agentDir = resolveAgentDir(cfg, agentId);
  const timeoutMs = resolveAgentTimeoutMs({ cfg, overrideSeconds: opts?.timeoutOverrideSeconds });
  const configuredTypingSeconds =
    agentCfg?.typingIntervalSeconds ?? sessionCfg?.typingIntervalSeconds;
  const typingIntervalSeconds =
    typeof configuredTypingSeconds === "number" ? configuredTypingSeconds : 6;
  const typing = createTypingController({
    onReplyStart: opts?.onReplyStart,
    onCleanup: opts?.onTypingCleanup,
    typingIntervalSeconds,
    silentToken: SILENT_REPLY_TOKEN,
    log: defaultRuntime.log,
  });
  opts?.onTypingController?.(typing);

  if (shouldUseBundledSkillFastpass(finalized)) {
    const bundledSkillFastpassRuntime = await loadBundledSkillFastpassRuntime();
    const bundledSkillFastpass = await bundledSkillFastpassRuntime.tryHandleBundledSkillFastpass({
      ctx: finalized,
      cfg,
    });
    if (bundledSkillFastpass.handled) {
      return bundledSkillFastpass.payload;
    }
  }

  if (!isFastTestEnv) {
    await applyMediaUnderstandingIfNeeded({
      ctx: finalized,
      cfg,
      agentDir,
      activeModel: { provider, model },
    });
    await applyLinkUnderstandingIfNeeded({
      ctx: finalized,
      cfg,
    });
  }
  emitPreAgentMessageHooks({
    ctx: finalized,
    cfg,
    isFastTestEnv,
  });

  const commandAuthorized = finalized.CommandAuthorized;
  resolveCommandAuthorization({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  const sessionState = await initSessionState({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  let {
    sessionCtx,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    isNewSession,
    resetTriggered,
    systemSent,
    abortedLastRun,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    bodyStripped,
  } = sessionState;

  if (resetTriggered && bodyStripped?.trim()) {
    const { applyResetModelOverride } = await loadSessionResetModelRuntime();
    await applyResetModelOverride({
      cfg,
      agentId,
      resetTriggered,
      bodyStripped,
      sessionCtx,
      ctx: finalized,
      sessionEntry,
      sessionStore,
      sessionKey,
      storePath,
      defaultProvider,
      defaultModel,
      aliasIndex,
    });
  }

  const channelModelOverride = resolveChannelModelOverride({
    cfg,
    channel:
      groupResolution?.channel ??
      sessionEntry.channel ??
      sessionEntry.origin?.provider ??
      (typeof finalized.OriginatingChannel === "string"
        ? finalized.OriginatingChannel
        : undefined) ??
      finalized.Provider,
    groupId: groupResolution?.id ?? sessionEntry.groupId,
    groupChannel: sessionEntry.groupChannel ?? sessionCtx.GroupChannel ?? finalized.GroupChannel,
    groupSubject: sessionEntry.subject ?? sessionCtx.GroupSubject ?? finalized.GroupSubject,
    parentSessionKey: sessionCtx.ParentSessionKey,
  });
  const hasSessionModelOverride = Boolean(
    sessionEntry.modelOverride?.trim() || sessionEntry.providerOverride?.trim(),
  );
  if (!hasResolvedHeartbeatModelOverride && !hasSessionModelOverride && channelModelOverride) {
    const resolved = resolveModelRefFromString({
      raw: channelModelOverride.model,
      defaultProvider,
      aliasIndex,
    });
    if (resolved) {
      provider = resolved.ref.provider;
      model = resolved.ref.model;
    }
  }

  const directiveResult = await resolveReplyDirectives({
    ctx: finalized,
    cfg,
    agentId,
    agentDir,
    workspaceDir,
    agentCfg,
    sessionCtx,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    commandAuthorized,
    defaultProvider,
    defaultModel,
    aliasIndex,
    provider,
    model,
    hasResolvedHeartbeatModelOverride,
    typing,
    opts: resolvedOpts,
    skillFilter: mergedSkillFilter,
  });
  if (directiveResult.kind === "reply") {
    return directiveResult.reply;
  }

  let {
    commandSource,
    command,
    allowTextCommands,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    provider: resolvedProvider,
    model: resolvedModel,
    modelState,
    contextTokens,
    inlineStatusRequested,
    directiveAck,
    perMessageQueueMode,
    perMessageQueueOptions,
  } = directiveResult.result;
  provider = resolvedProvider;
  model = resolvedModel;

  const maybeEmitMissingResetHooks = async () => {
    if (!resetTriggered || !command.isAuthorizedSender || command.resetHookTriggered) {
      return;
    }
    const resetMatch = command.commandBodyNormalized.match(/^\/(new|reset)(?:\s|$)/);
    if (!resetMatch) {
      return;
    }
    const { emitResetCommandHooks } = await import("./commands-core.runtime.js");
    const action: ResetCommandAction = resetMatch[1] === "reset" ? "reset" : "new";
    await emitResetCommandHooks({
      action,
      ctx,
      cfg,
      command,
      sessionKey,
      sessionEntry,
      previousSessionEntry,
      workspaceDir,
    });
  };

  const inlineActionResult = await handleInlineActions({
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    isGroup,
    opts: resolvedOpts,
    typing,
    allowTextCommands,
    inlineStatusRequested,
    command,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation: () => defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    resolveDefaultThinkingLevel: modelState.resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    directiveAck,
    abortedLastRun,
    skillFilter: mergedSkillFilter,
  });
  if (inlineActionResult.kind === "reply") {
    await maybeEmitMissingResetHooks();
    return inlineActionResult.reply;
  }
  await maybeEmitMissingResetHooks();
  directives = inlineActionResult.directives;
  abortedLastRun = inlineActionResult.abortedLastRun ?? abortedLastRun;

  if (sessionKey && hasInboundMedia(ctx)) {
    const { stageSandboxMedia } = await loadStageSandboxMediaRuntime();
    await stageSandboxMedia({
      ctx,
      sessionCtx,
      cfg,
      sessionKey,
      workspaceDir,
    });
  }

  return runPreparedReply({
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    agentCfg,
    sessionCfg,
    commandAuthorized,
    command,
    commandSource,
    allowTextCommands,
    directives,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    elevatedEnabled,
    elevatedAllowed,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    modelState,
    provider,
    model,
    perMessageQueueMode,
    perMessageQueueOptions,
    typing,
    opts: resolvedOpts,
    defaultProvider,
    defaultModel,
    timeoutMs,
    isNewSession,
    resetTriggered,
    systemSent,
    sessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    storePath,
    workspaceDir,
    abortedLastRun,
  });
}
