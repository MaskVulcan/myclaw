import type { OpenClawConfig } from "../config/config.js";
import {
  isNodeCommandAllowed,
  resolveNodeCommandAllowlist,
} from "../gateway/node-command-policy.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { runBeforeToolCallHook, type HookContext } from "./pi-tools.before-tool-call.js";
import {
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
  resolveSubagentToolPolicyForSession,
} from "./pi-tools.policy.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import type { SandboxToolPolicy } from "./sandbox/types.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
  type ToolPolicyPipelineStep,
} from "./tool-policy-pipeline.js";
import {
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  resolveToolProfilePolicy,
} from "./tool-policy.js";

export const DEFAULT_POLICY_KERNEL_ID = "builtin-policy" as const;

export type PolicyKernelId = typeof DEFAULT_POLICY_KERNEL_ID;
export type PolicyKernelSubagentPolicyMode = "default" | "session" | "off";
export type PolicyKernelToolMetaResolver = (tool: AnyAgentTool) => { pluginId: string } | undefined;

export type PolicyKernelResolvedToolPolicy = {
  agentId?: string;
  profile?: string;
  providerProfile?: string;
  globalPolicy?: SandboxToolPolicy;
  globalProviderPolicy?: SandboxToolPolicy;
  agentPolicy?: SandboxToolPolicy;
  agentProviderPolicy?: SandboxToolPolicy;
  groupPolicy?: SandboxToolPolicy;
  sandboxPolicy?: SandboxToolPolicy;
  subagentPolicy?: SandboxToolPolicy;
  explicitAllowlist: string[];
  matchPolicies: Array<SandboxToolPolicy | undefined>;
  pipelineSteps: ToolPolicyPipelineStep[];
};

export type PolicyKernelResolveToolPolicyParams = {
  config?: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
  modelProvider?: string;
  modelId?: string;
  spawnedBy?: string | null;
  messageProvider?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  accountId?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  sandboxToolPolicy?: SandboxToolPolicy;
  subagentPolicyMode?: PolicyKernelSubagentPolicyMode;
};

export type PolicyKernelApplyToolPolicyParams = {
  tools: AnyAgentTool[];
  toolMeta: PolicyKernelToolMetaResolver;
  warn: (message: string) => void;
  resolvedPolicy: PolicyKernelResolvedToolPolicy;
};

export type PolicyKernelWorkspacePathParams = {
  filePath: string;
  cwd: string;
  workspaceRoot: string;
  allowFinalSymlinkForUnlink?: boolean;
  allowFinalHardlinkForUnlink?: boolean;
};

export type PolicyKernelBeforeToolCallParams = Parameters<typeof runBeforeToolCallHook>[0];
export type PolicyKernelBeforeToolCallResult = Awaited<ReturnType<typeof runBeforeToolCallHook>>;
export type PolicyKernelNodeAllowlistParams = Parameters<typeof resolveNodeCommandAllowlist>;
export type PolicyKernelNodeAllowedParams = Parameters<typeof isNodeCommandAllowed>[0];
export type PolicyKernelToolAllowedPolicies = Parameters<typeof isToolAllowedByPolicies>[1];

export type PolicyKernel = {
  id: PolicyKernelId;
  resolveToolPolicy: (
    params: PolicyKernelResolveToolPolicyParams,
  ) => PolicyKernelResolvedToolPolicy;
  applyToolPolicy: (params: PolicyKernelApplyToolPolicyParams) => AnyAgentTool[];
  isToolAllowed: (
    toolName: string,
    policies: PolicyKernelToolAllowedPolicies,
  ) => ReturnType<typeof isToolAllowedByPolicies>;
  runBeforeToolCall: (
    params: PolicyKernelBeforeToolCallParams,
  ) => Promise<PolicyKernelBeforeToolCallResult>;
  assertWorkspacePath: (
    params: PolicyKernelWorkspacePathParams,
  ) => ReturnType<typeof assertSandboxPath>;
  resolveNodeCommandAllowlist: (
    ...params: PolicyKernelNodeAllowlistParams
  ) => ReturnType<typeof resolveNodeCommandAllowlist>;
  isNodeCommandAllowed: (
    params: PolicyKernelNodeAllowedParams,
  ) => ReturnType<typeof isNodeCommandAllowed>;
};

function toSandboxToolPolicy(
  policy: { allow?: string[]; deny?: string[] } | undefined,
): SandboxToolPolicy | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    ...(Array.isArray(policy.allow) ? { allow: policy.allow } : {}),
    ...(Array.isArray(policy.deny) ? { deny: policy.deny } : {}),
  };
}

function resolvePolicyKernelSubagentPolicy(
  params: PolicyKernelResolveToolPolicyParams,
): SandboxToolPolicy | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey || !isSubagentSessionKey(sessionKey)) {
    return undefined;
  }

  const mode = params.subagentPolicyMode ?? "session";
  if (mode === "off") {
    return undefined;
  }
  if (mode === "default") {
    return resolveSubagentToolPolicy(params.config);
  }
  return resolveSubagentToolPolicyForSession(params.config, sessionKey);
}

const defaultPolicyKernel: PolicyKernel = {
  id: DEFAULT_POLICY_KERNEL_ID,
  resolveToolPolicy: (params) => {
    const effectivePolicy = resolveEffectiveToolPolicy({
      config: params.config,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      modelProvider: params.modelProvider,
      modelId: params.modelId,
    });
    const profilePolicy = resolveToolProfilePolicy(effectivePolicy.profile);
    const providerProfilePolicy = resolveToolProfilePolicy(effectivePolicy.providerProfile);
    const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
      profilePolicy,
      effectivePolicy.profileAlsoAllow,
    );
    const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
      providerProfilePolicy,
      effectivePolicy.providerProfileAlsoAllow,
    );
    const groupPolicy = resolveGroupToolPolicy({
      config: params.config,
      sessionKey: params.sessionKey,
      spawnedBy: params.spawnedBy,
      messageProvider: params.messageProvider,
      groupId: params.groupId,
      groupChannel: params.groupChannel,
      groupSpace: params.groupSpace,
      accountId: params.accountId,
      senderId: params.senderId,
      senderName: params.senderName,
      senderUsername: params.senderUsername,
      senderE164: params.senderE164,
    });
    const subagentPolicy = resolvePolicyKernelSubagentPolicy(params);
    const sandboxPolicy = params.sandboxToolPolicy;

    return {
      agentId: effectivePolicy.agentId,
      profile: effectivePolicy.profile,
      providerProfile: effectivePolicy.providerProfile,
      globalPolicy: effectivePolicy.globalPolicy,
      globalProviderPolicy: effectivePolicy.globalProviderPolicy,
      agentPolicy: effectivePolicy.agentPolicy,
      agentProviderPolicy: effectivePolicy.agentProviderPolicy,
      groupPolicy,
      sandboxPolicy,
      subagentPolicy,
      explicitAllowlist: collectExplicitAllowlist([
        profilePolicy,
        providerProfilePolicy,
        effectivePolicy.globalPolicy,
        effectivePolicy.globalProviderPolicy,
        effectivePolicy.agentPolicy,
        effectivePolicy.agentProviderPolicy,
        groupPolicy,
        sandboxPolicy,
        subagentPolicy,
      ]),
      matchPolicies: [
        toSandboxToolPolicy(profilePolicyWithAlsoAllow),
        toSandboxToolPolicy(providerProfilePolicyWithAlsoAllow),
        effectivePolicy.globalPolicy,
        effectivePolicy.globalProviderPolicy,
        effectivePolicy.agentPolicy,
        effectivePolicy.agentProviderPolicy,
        groupPolicy,
        sandboxPolicy,
        subagentPolicy,
      ],
      pipelineSteps: [
        ...buildDefaultToolPolicyPipelineSteps({
          profilePolicy: profilePolicyWithAlsoAllow,
          profile: effectivePolicy.profile,
          profileAlsoAllow: effectivePolicy.profileAlsoAllow,
          providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
          providerProfile: effectivePolicy.providerProfile,
          providerProfileAlsoAllow: effectivePolicy.providerProfileAlsoAllow,
          globalPolicy: effectivePolicy.globalPolicy,
          globalProviderPolicy: effectivePolicy.globalProviderPolicy,
          agentPolicy: effectivePolicy.agentPolicy,
          agentProviderPolicy: effectivePolicy.agentProviderPolicy,
          groupPolicy,
          agentId: effectivePolicy.agentId,
        }),
        ...(sandboxPolicy ? [{ policy: sandboxPolicy, label: "sandbox tools.allow" }] : []),
        ...(subagentPolicy ? [{ policy: subagentPolicy, label: "subagent tools.allow" }] : []),
      ],
    };
  },
  applyToolPolicy: (params) =>
    applyToolPolicyPipeline({
      tools: params.tools,
      toolMeta: params.toolMeta,
      warn: params.warn,
      steps: params.resolvedPolicy.pipelineSteps,
    }),
  isToolAllowed: (toolName, policies) => isToolAllowedByPolicies(toolName, policies),
  runBeforeToolCall: async (params) => await runBeforeToolCallHook(params),
  assertWorkspacePath: async (params) =>
    await assertSandboxPath({
      filePath: params.filePath,
      cwd: params.cwd,
      root: params.workspaceRoot,
      allowFinalSymlinkForUnlink: params.allowFinalSymlinkForUnlink,
      allowFinalHardlinkForUnlink: params.allowFinalHardlinkForUnlink,
    }),
  resolveNodeCommandAllowlist: (...params) => resolveNodeCommandAllowlist(...params),
  isNodeCommandAllowed: (params) => isNodeCommandAllowed(params),
};

export function resolveDefaultPolicyKernel(): PolicyKernel {
  return defaultPolicyKernel;
}

export type { HookContext };
