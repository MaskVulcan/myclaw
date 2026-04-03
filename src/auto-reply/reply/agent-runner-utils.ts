import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import { buildModelAliasIndex, resolveModelRefFromString } from "../../agents/model-selection.js";
import type { PromptMode } from "../../agents/system-prompt.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { ChannelId, ChannelThreadingToolContext } from "../../channels/plugins/types.js";
import { normalizeAnyChannelId, normalizeChannelId } from "../../channels/registry.js";
import type { OpenClawConfig } from "../../config/config.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import type { TemplateContext } from "../templating.js";
import {
  resolveProviderScopedAuthProfile,
  resolveRunAuthProfile,
} from "./agent-runner-auth-profile.js";
export { resolveProviderScopedAuthProfile, resolveRunAuthProfile };
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
import type { FollowupRun } from "./queue.js";

const BUN_FETCH_SOCKET_ERROR_RE = /socket connection was closed unexpectedly/i;

type SkillsPromptMode = "auto" | "compact" | "off";

type BootstrapContextMode = "full" | "lightweight";

export const MULTI_STAGE_ESCALATION_MARKER = "[[openclaw_stage2]]";

export type EmbeddedRunStagePlan = {
  provider: string;
  model: string;
  explicitModel: boolean;
  thinkLevel?: FollowupRun["run"]["thinkLevel"];
  fastMode?: boolean;
  reasoningLevel?: FollowupRun["run"]["reasoningLevel"];
  systemPromptMode?: PromptMode;
  skillsPromptMode?: SkillsPromptMode;
  bootstrapContextMode?: BootstrapContextMode;
  disableTools?: boolean;
  inheritExtraSystemPrompt?: boolean;
  extraSystemPrompt?: string;
};

export type MultiStageRoutingPlan = {
  escalationMarker: string;
  bypassFastPassReason?: string;
  fastPass: EmbeddedRunStagePlan;
  escalationPass: EmbeddedRunStagePlan;
};

const FAST_PASS_COMPLEX_ACTION_RE =
  /(?:分析|排查|定位|设计|方案|优化|对比|比较|同步|迁移|回滚|重构|修复|benchmark|profile|部署|重启|提交|commit|push|pull|rebase|merge|lint|eslint|tsgo|typecheck|trace|debug)/i;

const FAST_PASS_COMPLEX_INSPECTION_RE =
  /(?:看|看看|查|查下|检查).*(?:日志|log|报错|错误|异常|配置|内存|延迟|耗时|性能|history|memory|recall|prompt|model|repo|仓库|上下文|context|session|embedding|token)/i;

const FAST_PASS_COMPLEX_QUESTION_RE =
  /(?:为什么|为何|怎么|如何|为啥|why|how).*(?:慢|卡|失败|报错|错误|异常|配置|代理|proxy|模型|model|prompt|会话|session|上下文|context|历史|history|记忆|memory|recall|embedding|token|性能|延迟|耗时|内存|repo|仓库|服务|gateway|worker|agent|systemd)/i;

const FAST_PASS_COMPLEX_FOLLOWUP_RE =
  /^(?:继续|接着|继续处理|继续优化|我发了|我又发了|还是慢|没反应|看下日志|看看日志|查日志|看日志|重启服务|看下原因|看看原因)$/i;

const FAST_PASS_STRUCTURED_MESSAGE_RE = /```|`|https?:\/\/|www\.|[#*_{}[\]<>]/i;

const FAST_PASS_SIMPLE_FILE_NOUN_RE =
  /(?:\.(?:pdf|docx?|pptx|xlsx|csv|txt|md|markdown|html?|xml|json|eml|rtf|odt)\b|pdf|docx|word|pptx|powerpoint|xlsx|excel|csv|markdown|html|xml|json|文档|文件|合同|发票|表格|幻灯片|课件|简历)/i;

const FAST_PASS_SIMPLE_FILE_ACTION_RE =
  /(?:翻译|提取|抽取|转换|转成|导出|导入|整理|读取|打开|合并|拆分|分割|压缩|解压|ocr|识别|总结|摘要|改写|重写|编辑|比较|对比|查找|替换|生成|导出成|导出为|extract|convert|translate|summari[sz]e|rewrite|edit|compare|merge|split|ocr|read|open)/i;

const FAST_PASS_SIMPLE_SCHEDULE_NOUN_RE =
  /(?:日程|日历|行程|安排|会议|约会|提醒|待办|计划|calendar|schedule|meeting|event|agenda|todo|reminder)/i;

const FAST_PASS_SIMPLE_SCHEDULE_ACTION_RE =
  /(?:添加|新增|安排|创建|记下|记个|提醒我|查询|查看|看下|看看|显示|列出|发我|告诉我|总结|汇总|生成图|生成图片|编辑|修改|更新|删除|取消|完成|add|create|schedule|show|list|view|edit|update|delete|remove|cancel|complete|render|image|summary)/i;

const FAST_PASS_SIMPLE_SCHEDULE_EVENT_RE =
  /(?:(?:今天|明天|后天|大后天|今晚|今早|本周|这周|下周|本月|这个月|下个月|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|周[一二三四五六日天]).{0,24}(?:开会|会议|见面|约会|提醒|行程|日程|安排|review|meeting|event))/i;

function resolveStageModelRef(params: { rawModel: string | undefined; run: FollowupRun["run"] }): {
  provider: string;
  model: string;
  explicitModel: boolean;
} {
  const rawModel = params.rawModel?.trim();
  if (!rawModel) {
    return {
      provider: params.run.provider,
      model: params.run.model,
      explicitModel: false,
    };
  }
  const aliasIndex = params.run.config
    ? buildModelAliasIndex({
        cfg: params.run.config,
        defaultProvider: params.run.provider,
      })
    : undefined;
  const resolved = resolveModelRefFromString({
    raw: rawModel,
    defaultProvider: params.run.provider,
    aliasIndex,
  });
  if (!resolved) {
    return {
      provider: params.run.provider,
      model: params.run.model,
      explicitModel: false,
    };
  }
  return {
    provider: resolved.ref.provider,
    model: resolved.ref.model,
    explicitModel: true,
  };
}

function joinSystemPromptSegments(...segments: Array<string | undefined>): string | undefined {
  const joined = segments
    .map((segment) => segment?.trim())
    .filter(Boolean)
    .join("\n\n");
  return joined || undefined;
}

function buildFastPassInstruction(marker: string): string {
  return [
    "Fast-pass mode.",
    "Handle direct simple requests and lightweight one-step tasks when you can do so confidently.",
    "Treat straightforward file-handling and schedule-management requests as eligible for fast-pass.",
    "When the request is genuinely about files/documents or schedules/calendars, use the injected skills and tools directly instead of guessing.",
    "Only extract fields that are grounded in the user's message, links, or attached files; if a key detail is missing or uncertain, escalate instead of inventing it.",
    "Do not activate file or schedule tooling for unrelated chats such as weather, small talk, or meta requests about skills/prompts.",
    "Keep the visible reply concise, plain-text, and directly useful.",
    "Do not self-introduce or mention provider/model details.",
    "Avoid markdown code fences, long tutorials, and broad explanations unless the user explicitly asked for them.",
    "If the task is obviously complex, multi-step, debugging/performance/config/history/design work, depends heavily on broader context, or you are uncertain, reply with the exact text below and nothing else.",
    marker,
  ].join("\n");
}

function resolveFastPassSourceText(params: {
  commandBody?: string;
  sessionCtx?: TemplateContext;
}): string {
  return (
    params.sessionCtx?.BodyForCommands ??
    params.sessionCtx?.CommandBody ??
    params.sessionCtx?.RawBody ??
    params.sessionCtx?.Body ??
    params.commandBody ??
    ""
  );
}

function isFastPassPreferredFileTask(normalized: string): boolean {
  return (
    FAST_PASS_SIMPLE_FILE_NOUN_RE.test(normalized) &&
    FAST_PASS_SIMPLE_FILE_ACTION_RE.test(normalized)
  );
}

function isFastPassPreferredScheduleTask(normalized: string): boolean {
  if (
    FAST_PASS_SIMPLE_SCHEDULE_NOUN_RE.test(normalized) &&
    FAST_PASS_SIMPLE_SCHEDULE_ACTION_RE.test(normalized)
  ) {
    return true;
  }
  return FAST_PASS_SIMPLE_SCHEDULE_EVENT_RE.test(normalized);
}

function prefersFastPassSkillPrompt(normalized: string): boolean {
  return isFastPassPreferredFileTask(normalized) || isFastPassPreferredScheduleTask(normalized);
}

function resolveFastPassBypassReason(params: {
  commandBody?: string;
  sessionCtx?: TemplateContext;
}): string | undefined {
  const raw = resolveFastPassSourceText(params);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  const preferredFileTask = isFastPassPreferredFileTask(normalized);
  const preferredScheduleTask = isFastPassPreferredScheduleTask(normalized);
  const preferredDirectTask = preferredFileTask || preferredScheduleTask;
  if (/(?:&&|\|\||;|；)/.test(normalized)) {
    return "compound_command";
  }
  if (FAST_PASS_COMPLEX_FOLLOWUP_RE.test(normalized)) {
    return "operational_followup";
  }
  if (FAST_PASS_COMPLEX_QUESTION_RE.test(normalized)) {
    return "complex_question";
  }
  if (FAST_PASS_COMPLEX_ACTION_RE.test(normalized)) {
    return "complex_action";
  }
  if (FAST_PASS_COMPLEX_INSPECTION_RE.test(normalized)) {
    return "complex_inspection";
  }
  if (preferredDirectTask) {
    return undefined;
  }
  if (raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length > 1) {
    return "multiline";
  }
  if (normalized.length > 160) {
    return "long_message";
  }
  if (FAST_PASS_STRUCTURED_MESSAGE_RE.test(normalized)) {
    return "structured_or_link";
  }
  return undefined;
}

export function resolveMultiStageRoutingPlan(params: {
  run: FollowupRun["run"];
  hasImages?: boolean;
  isHeartbeat?: boolean;
  commandBody?: string;
  sessionCtx?: TemplateContext;
}): MultiStageRoutingPlan | null {
  const routing = params.run.config?.agents?.defaults?.multiStageRouting;
  if (!routing?.enabled) {
    return null;
  }
  if (params.isHeartbeat) {
    return null;
  }
  if (params.hasImages && routing.skipImages !== false) {
    return null;
  }

  const fastPassModel = resolveStageModelRef({
    rawModel: routing.fastPass?.model,
    run: params.run,
  });
  const escalationPassModel = resolveStageModelRef({
    rawModel: routing.escalationPass?.model,
    run: params.run,
  });
  const sourceText = resolveFastPassSourceText({
    commandBody: params.commandBody,
    sessionCtx: params.sessionCtx,
  });
  const normalizedSourceText = sourceText.replace(/\s+/g, " ").trim();
  const prefersDirectSkillHandling = prefersFastPassSkillPrompt(normalizedSourceText);
  const fastPassSkillsPromptMode =
    routing.fastPass?.skillsPromptMode ??
    (prefersDirectSkillHandling ? "auto" : "off");

  return {
    escalationMarker: MULTI_STAGE_ESCALATION_MARKER,
    bypassFastPassReason: resolveFastPassBypassReason({
      commandBody: params.commandBody,
      sessionCtx: params.sessionCtx,
    }),
    fastPass: {
      provider: fastPassModel.provider,
      model: fastPassModel.model,
      explicitModel: fastPassModel.explicitModel,
      thinkLevel: routing.fastPass?.thinkLevel ?? "low",
      fastMode: routing.fastPass?.fastMode ?? true,
      reasoningLevel: routing.fastPass?.reasoningLevel ?? "off",
      systemPromptMode: routing.fastPass?.systemPromptMode ?? "none",
      skillsPromptMode: fastPassSkillsPromptMode,
      bootstrapContextMode: routing.fastPass?.bootstrapContextMode ?? "lightweight",
      disableTools: routing.fastPass?.disableTools ?? !prefersDirectSkillHandling,
      inheritExtraSystemPrompt: routing.fastPass?.inheritExtraSystemPrompt ?? false,
      extraSystemPrompt: joinSystemPromptSegments(
        routing.fastPass?.extraSystemPrompt,
        buildFastPassInstruction(MULTI_STAGE_ESCALATION_MARKER),
      ),
    },
    escalationPass: {
      provider: escalationPassModel.provider,
      model: escalationPassModel.model,
      explicitModel: escalationPassModel.explicitModel,
      thinkLevel: routing.escalationPass?.thinkLevel ?? params.run.thinkLevel,
      fastMode: routing.escalationPass?.fastMode ?? params.run.fastMode,
      reasoningLevel: routing.escalationPass?.reasoningLevel ?? params.run.reasoningLevel,
      systemPromptMode: routing.escalationPass?.systemPromptMode ?? "full",
      skillsPromptMode: routing.escalationPass?.skillsPromptMode ?? "auto",
      bootstrapContextMode: routing.escalationPass?.bootstrapContextMode ?? "full",
      disableTools: routing.escalationPass?.disableTools ?? false,
      inheritExtraSystemPrompt: routing.escalationPass?.inheritExtraSystemPrompt ?? true,
      extraSystemPrompt: routing.escalationPass?.extraSystemPrompt?.trim() || undefined,
    },
  };
}

/**
 * Build provider-specific threading context for tool auto-injection.
 */
export function buildThreadingToolContext(params: {
  sessionCtx: TemplateContext;
  config: OpenClawConfig | undefined;
  hasRepliedRef: { value: boolean } | undefined;
}): ChannelThreadingToolContext {
  const { sessionCtx, config, hasRepliedRef } = params;
  const currentMessageId = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;
  const originProvider = resolveOriginMessageProvider({
    originatingChannel: sessionCtx.OriginatingChannel,
    provider: sessionCtx.Provider,
  });
  const originTo = resolveOriginMessageTo({
    originatingTo: sessionCtx.OriginatingTo,
    to: sessionCtx.To,
  });
  if (!config) {
    return {
      currentMessageId,
    };
  }
  const rawProvider = originProvider?.trim().toLowerCase();
  if (!rawProvider) {
    return {
      currentMessageId,
    };
  }
  const provider = normalizeChannelId(rawProvider) ?? normalizeAnyChannelId(rawProvider);
  // Fallback for unrecognized/plugin channels (e.g., BlueBubbles before plugin registry init)
  const threading = provider ? getChannelPlugin(provider)?.threading : undefined;
  if (!threading?.buildToolContext) {
    return {
      currentChannelId: originTo?.trim() || undefined,
      currentChannelProvider: provider ?? (rawProvider as ChannelId),
      currentMessageId,
      hasRepliedRef,
    };
  }
  const context =
    threading.buildToolContext({
      cfg: config,
      accountId: sessionCtx.AccountId,
      context: {
        Channel: originProvider,
        From: sessionCtx.From,
        To: originTo,
        ChatType: sessionCtx.ChatType,
        CurrentMessageId: currentMessageId,
        ReplyToId: sessionCtx.ReplyToId,
        ThreadLabel: sessionCtx.ThreadLabel,
        MessageThreadId: sessionCtx.MessageThreadId,
        NativeChannelId: sessionCtx.NativeChannelId,
      },
      hasRepliedRef,
    }) ?? {};
  return {
    ...context,
    currentChannelProvider: provider!, // guaranteed non-null since threading exists
    currentMessageId: context.currentMessageId ?? currentMessageId,
  };
}

export const isBunFetchSocketError = (message?: string) =>
  Boolean(message && BUN_FETCH_SOCKET_ERROR_RE.test(message));

export const formatBunFetchSocketError = (message: string) => {
  const trimmed = message.trim();
  return [
    "⚠️ LLM connection failed. This could be due to server issues, network problems, or context length exceeded (e.g., with local LLMs like LM Studio). Original error:",
    "```",
    trimmed || "Unknown error",
    "```",
  ].join("\n");
};

export const resolveEnforceFinalTag = (run: FollowupRun["run"], provider: string) =>
  Boolean(run.enforceFinalTag || isReasoningTagProvider(provider));

export function resolveModelFallbackOptions(run: FollowupRun["run"]) {
  return {
    cfg: run.config,
    provider: run.provider,
    model: run.model,
    agentDir: run.agentDir,
    fallbacksOverride: resolveRunModelFallbacksOverride({
      cfg: run.config,
      agentId: run.agentId,
      sessionKey: run.sessionKey,
    }),
  };
}

export function buildEmbeddedRunBaseParams(params: {
  run: FollowupRun["run"];
  provider: string;
  model: string;
  runId: string;
  authProfile: ReturnType<typeof resolveProviderScopedAuthProfile>;
  allowTransientCooldownProbe?: boolean;
}) {
  return {
    sessionFile: params.run.sessionFile,
    workspaceDir: params.run.workspaceDir,
    agentDir: params.run.agentDir,
    config: params.run.config,
    skillsSnapshot: params.run.skillsSnapshot,
    ownerNumbers: params.run.ownerNumbers,
    inputProvenance: params.run.inputProvenance,
    senderIsOwner: params.run.senderIsOwner,
    enforceFinalTag: resolveEnforceFinalTag(params.run, params.provider),
    provider: params.provider,
    model: params.model,
    ...params.authProfile,
    thinkLevel: params.run.thinkLevel,
    fastMode: params.run.fastMode,
    verboseLevel: params.run.verboseLevel,
    reasoningLevel: params.run.reasoningLevel,
    execOverrides: params.run.execOverrides,
    bashElevated: params.run.bashElevated,
    timeoutMs: params.run.timeoutMs,
    runId: params.runId,
    allowTransientCooldownProbe: params.allowTransientCooldownProbe,
  };
}

export function buildEmbeddedContextFromTemplate(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
}) {
  return {
    sessionId: params.run.sessionId,
    sessionKey: params.run.sessionKey,
    agentId: params.run.agentId,
    messageProvider: resolveOriginMessageProvider({
      originatingChannel: params.sessionCtx.OriginatingChannel,
      provider: params.sessionCtx.Provider,
    }),
    agentAccountId: params.sessionCtx.AccountId,
    messageTo: resolveOriginMessageTo({
      originatingTo: params.sessionCtx.OriginatingTo,
      to: params.sessionCtx.To,
    }),
    messageThreadId: params.sessionCtx.MessageThreadId ?? undefined,
    // Provider threading context for tool auto-injection
    ...buildThreadingToolContext({
      sessionCtx: params.sessionCtx,
      config: params.run.config,
      hasRepliedRef: params.hasRepliedRef,
    }),
  };
}

export function buildTemplateSenderContext(sessionCtx: TemplateContext) {
  return {
    senderId: sessionCtx.SenderId?.trim() || undefined,
    senderName: sessionCtx.SenderName?.trim() || undefined,
    senderUsername: sessionCtx.SenderUsername?.trim() || undefined,
    senderE164: sessionCtx.SenderE164?.trim() || undefined,
  };
}

export function buildEmbeddedRunContexts(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
  provider: string;
}) {
  return {
    authProfile: resolveRunAuthProfile(params.run, params.provider),
    embeddedContext: buildEmbeddedContextFromTemplate({
      run: params.run,
      sessionCtx: params.sessionCtx,
      hasRepliedRef: params.hasRepliedRef,
    }),
    senderContext: buildTemplateSenderContext(params.sessionCtx),
  };
}

export function buildEmbeddedRunExecutionParams(params: {
  run: FollowupRun["run"];
  sessionCtx: TemplateContext;
  hasRepliedRef: { value: boolean } | undefined;
  provider: string;
  model: string;
  runId: string;
  allowTransientCooldownProbe?: boolean;
}) {
  const { authProfile, embeddedContext, senderContext } = buildEmbeddedRunContexts(params);
  const runBaseParams = buildEmbeddedRunBaseParams({
    run: params.run,
    provider: params.provider,
    model: params.model,
    runId: params.runId,
    authProfile,
    allowTransientCooldownProbe: params.allowTransientCooldownProbe,
  });
  return {
    embeddedContext,
    senderContext,
    runBaseParams,
  };
}
