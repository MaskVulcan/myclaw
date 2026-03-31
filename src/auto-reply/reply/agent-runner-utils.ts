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
  fastPass: EmbeddedRunStagePlan;
  escalationPass: EmbeddedRunStagePlan;
};

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
    "Answer directly only when the request is simple and you can respond confidently without tools, repo inspection, or long reasoning.",
    "If you need file reads, tool use, broader context, careful deliberation, or you are uncertain, reply with the exact text below and nothing else.",
    marker,
  ].join("\n");
}

export function resolveMultiStageRoutingPlan(params: {
  run: FollowupRun["run"];
  hasImages?: boolean;
  isHeartbeat?: boolean;
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

  return {
    escalationMarker: MULTI_STAGE_ESCALATION_MARKER,
    fastPass: {
      provider: fastPassModel.provider,
      model: fastPassModel.model,
      explicitModel: fastPassModel.explicitModel,
      thinkLevel: routing.fastPass?.thinkLevel ?? "low",
      fastMode: routing.fastPass?.fastMode ?? true,
      reasoningLevel: routing.fastPass?.reasoningLevel ?? "off",
      systemPromptMode: routing.fastPass?.systemPromptMode ?? "none",
      skillsPromptMode: routing.fastPass?.skillsPromptMode ?? "off",
      bootstrapContextMode: routing.fastPass?.bootstrapContextMode ?? "lightweight",
      disableTools: routing.fastPass?.disableTools ?? true,
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
