import { describe, expect, it } from "vitest";
import type { FollowupRun } from "./queue.js";

const {
  MULTI_STAGE_ESCALATION_MARKER,
  buildThreadingToolContext,
  buildEmbeddedRunBaseParams,
  buildEmbeddedRunContexts,
  resolveMultiStageRoutingPlan,
  resolveModelFallbackOptions,
  resolveProviderScopedAuthProfile,
} = await import("./agent-runner-utils.js");

function makeRun(overrides: Partial<FollowupRun["run"]> = {}): FollowupRun["run"] {
  return {
    sessionId: "session-1",
    agentId: "agent-1",
    config: { models: { providers: {} } },
    provider: "openai",
    model: "gpt-4.1",
    agentDir: "/tmp/agent",
    sessionKey: "agent:test:session",
    sessionFile: "/tmp/session.json",
    workspaceDir: "/tmp/workspace",
    skillsSnapshot: [],
    ownerNumbers: ["+15550001"],
    enforceFinalTag: false,
    thinkLevel: "medium",
    verboseLevel: "off",
    reasoningLevel: "none",
    execOverrides: {},
    bashElevated: false,
    timeoutMs: 60_000,
    ...overrides,
  } as unknown as FollowupRun["run"];
}

describe("agent-runner-utils", () => {
  it("resolves model fallback options from run context", () => {
    const run = makeRun({
      config: {
        agents: {
          list: [
            {
              id: "agent-1",
              model: {
                primary: "openai/gpt-4.1",
                fallbacks: ["openai/gpt-4.1-mini"],
              },
            },
          ],
        },
      },
    });

    const resolved = resolveModelFallbackOptions(run);

    expect(resolved).toEqual({
      cfg: run.config,
      provider: run.provider,
      model: run.model,
      agentDir: run.agentDir,
      fallbacksOverride: ["openai/gpt-4.1-mini"],
    });
  });

  it("allows helper-based fallback resolution when agentId is missing", () => {
    const run = makeRun({
      agentId: undefined,
      sessionKey: undefined,
    });

    const resolved = resolveModelFallbackOptions(run);

    expect(resolved.fallbacksOverride).toBeUndefined();
  });

  it("builds embedded run base params with auth profile and run metadata", () => {
    const run = makeRun({ enforceFinalTag: true, fastMode: true });
    const authProfile = resolveProviderScopedAuthProfile({
      provider: "openai",
      primaryProvider: "openai",
      authProfileId: "profile-openai",
      authProfileIdSource: "user",
    });

    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      authProfile,
    });

    expect(resolved).toMatchObject({
      sessionFile: run.sessionFile,
      workspaceDir: run.workspaceDir,
      agentDir: run.agentDir,
      config: run.config,
      skillsSnapshot: run.skillsSnapshot,
      ownerNumbers: run.ownerNumbers,
      enforceFinalTag: true,
      provider: "openai",
      model: "gpt-4.1-mini",
      authProfileId: "profile-openai",
      authProfileIdSource: "user",
      thinkLevel: run.thinkLevel,
      fastMode: run.fastMode,
      verboseLevel: run.verboseLevel,
      reasoningLevel: run.reasoningLevel,
      execOverrides: run.execOverrides,
      bashElevated: run.bashElevated,
      timeoutMs: run.timeoutMs,
      runId: "run-1",
    });
  });

  it("builds embedded contexts and scopes auth profile by provider", () => {
    const run = makeRun({
      authProfileId: "profile-openai",
      authProfileIdSource: "auto",
    });

    const resolved = buildEmbeddedRunContexts({
      run,
      sessionCtx: {
        Provider: "OpenAI",
        To: "channel-1",
        SenderId: "sender-1",
      },
      hasRepliedRef: undefined,
      provider: "anthropic",
    });

    expect(resolved.authProfile).toEqual({
      authProfileId: undefined,
      authProfileIdSource: undefined,
    });
    expect(resolved.embeddedContext).toMatchObject({
      sessionId: run.sessionId,
      sessionKey: run.sessionKey,
      agentId: run.agentId,
      messageProvider: "openai",
      messageTo: "channel-1",
    });
    expect(resolved.senderContext).toEqual({
      senderId: "sender-1",
      senderName: undefined,
      senderUsername: undefined,
      senderE164: undefined,
    });
  });

  it("prefers OriginatingChannel over Provider for messageProvider", () => {
    const run = makeRun();

    const resolved = buildEmbeddedRunContexts({
      run,
      sessionCtx: {
        Provider: "heartbeat",
        OriginatingChannel: "Telegram",
        OriginatingTo: "268300329",
      },
      hasRepliedRef: undefined,
      provider: "openai",
    });

    expect(resolved.embeddedContext.messageProvider).toBe("telegram");
    expect(resolved.embeddedContext.messageTo).toBe("268300329");
  });

  it("uses OriginatingTo for telegram native command tool context without implicit thread state", () => {
    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "telegram",
        To: "slash:8460800771",
        OriginatingChannel: "telegram",
        OriginatingTo: "telegram:-1003841603622",
        MessageThreadId: 928,
        MessageSid: "2284",
      },
      config: { channels: { telegram: { allowFrom: ["*"] } } },
      hasRepliedRef: undefined,
    });

    expect(context).toMatchObject({
      currentChannelId: "telegram:-1003841603622",
      currentMessageId: "2284",
    });
    expect(context.currentThreadTs).toBeUndefined();
  });

  it("uses OriginatingTo for threading tool context on discord native commands", () => {
    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "discord",
        To: "slash:1177378744822943744",
        OriginatingChannel: "discord",
        OriginatingTo: "channel:123456789012345678",
        MessageSid: "msg-9",
      },
      config: {},
      hasRepliedRef: undefined,
    });

    expect(context).toMatchObject({
      currentChannelId: "channel:123456789012345678",
      currentMessageId: "msg-9",
    });
  });

  it("resolves a staged routing plan with lean fast-pass defaults", () => {
    const run = makeRun({
      provider: "codex-vip",
      model: "gpt-5.4",
      thinkLevel: "medium",
      fastMode: false,
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
              fastPass: {
                model: "codex-vip/gpt-5.2",
              },
              escalationPass: {
                model: "codex-vip/gpt-5.4",
                thinkLevel: "xhigh",
                fastMode: false,
              },
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
    });

    expect(plan).toMatchObject({
      escalationMarker: MULTI_STAGE_ESCALATION_MARKER,
      fastPass: {
        provider: "codex-vip",
        model: "gpt-5.2",
        explicitModel: true,
        thinkLevel: "low",
        fastMode: true,
        systemPromptMode: "none",
        skillsPromptMode: "off",
        bootstrapContextMode: "lightweight",
        disableTools: true,
        inheritExtraSystemPrompt: false,
      },
      escalationPass: {
        provider: "codex-vip",
        model: "gpt-5.4",
        explicitModel: true,
        thinkLevel: "xhigh",
        fastMode: false,
        systemPromptMode: "full",
        skillsPromptMode: "auto",
        bootstrapContextMode: "full",
        disableTools: false,
        inheritExtraSystemPrompt: true,
      },
    });
    expect(plan?.fastPass.extraSystemPrompt).toContain(MULTI_STAGE_ESCALATION_MARKER);
    expect(plan?.fastPass.extraSystemPrompt).toContain(
      "Handle direct simple requests and lightweight one-step tasks",
    );
    expect(plan?.fastPass.extraSystemPrompt).toContain("Keep the visible reply concise");
    expect(plan?.bypassFastPassReason).toBeUndefined();
  });

  it("bypasses fast-pass for complex or context-dependent requests", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "你看看日志，分析下为什么这么慢",
      },
    });

    expect(plan?.bypassFastPassReason).toBe("complex_question");
  });

  it("keeps fast-pass enabled for trivial greetings", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "在吗",
      },
    });

    expect(plan?.bypassFastPassReason).toBeUndefined();
  });

  it("keeps fast-pass enabled for simple one-step inspection requests", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "看下 package.json 版本",
      },
    });

    expect(plan?.bypassFastPassReason).toBeUndefined();
  });

  it("keeps fast-pass enabled for direct file-processing requests with inline file refs", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "把 `contract.docx` 转成 markdown",
      },
    });

    expect(plan?.bypassFastPassReason).toBeUndefined();
  });

  it("keeps fast-pass enabled for direct schedule-management requests", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "明天下午3点和张总开会，帮我记个日程",
      },
    });

    expect(plan?.bypassFastPassReason).toBeUndefined();
  });

  it("injects compact skills prompts for direct file and schedule fast-pass candidates", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const filePlan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "把 contract.pdf 总结一下",
      },
    });
    const schedulePlan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "发我未来七天的日程",
      },
    });

    expect(filePlan?.fastPass.skillsPromptMode).toBe("compact");
    expect(schedulePlan?.fastPass.skillsPromptMode).toBe("compact");
  });

  it("still bypasses fast-pass for explanatory file-processing questions", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    const plan = resolveMultiStageRoutingPlan({
      run,
      hasImages: false,
      isHeartbeat: false,
      sessionCtx: {
        BodyForCommands: "为什么这个 pdf 提取失败",
      },
    });

    expect(plan?.bypassFastPassReason).toBe("complex_question");
  });

  it("skips staged routing when images are present", () => {
    const run = makeRun({
      config: {
        agents: {
          defaults: {
            multiStageRouting: {
              enabled: true,
            },
          },
        },
      },
    });

    expect(
      resolveMultiStageRoutingPlan({
        run,
        hasImages: true,
        isHeartbeat: false,
      }),
    ).toBeNull();
  });
});
