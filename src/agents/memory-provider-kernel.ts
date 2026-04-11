import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import type { MemoryCitationsMode } from "../config/types.memory.js";
import type {
  ContextEngine,
  SubagentEndReason,
  SubagentSpawnPreparation,
} from "../context-engine/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  closeActiveMemorySearchManagers,
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
} from "../plugins/memory-runtime.js";
import { buildMemoryPromptSection, resolveMemoryFlushPlan } from "../plugins/memory-state.js";
import type { RuntimeEnv } from "../runtime.js";
import { runContextEngineMaintenance } from "./pi-embedded-runner/context-engine-maintenance.js";
import {
  finalizeAttemptContextEngineTurn,
  runAttemptContextEngineBootstrap,
} from "./pi-embedded-runner/run/attempt.context-engine-helpers.js";

const log = createSubsystemLogger("agents/memory-provider-kernel");

export const DEFAULT_MEMORY_PROVIDER_KERNEL_ID = "plugin-memory" as const;
export const DEFAULT_MEMORY_STEWARD_CURATE_LIMIT = 20;
export const DEFAULT_MEMORY_STEWARD_INCUBATE_LIMIT = 50;
export const DEFAULT_MEMORY_STEWARD_PROMOTE_LIMIT = 50;
export const DEFAULT_MEMORY_STEWARD_MIN_CANDIDATES = 2;

export type MemoryProviderKernelId = typeof DEFAULT_MEMORY_PROVIDER_KERNEL_ID;
export type MemoryProviderBootstrapParams = Parameters<typeof runAttemptContextEngineBootstrap>[0];
export type MemoryProviderTurnSyncParams = Parameters<typeof finalizeAttemptContextEngineTurn>[0];
export type MemoryProviderMaintenanceParams = Parameters<typeof runContextEngineMaintenance>[0];
export type MemoryProviderSystemPromptParams = {
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
};
export type MemoryProviderPrefetchParams = Parameters<typeof getActiveMemorySearchManager>[0];
export type MemoryProviderBackendConfigParams = Parameters<
  typeof resolveActiveMemoryBackendConfig
>[0];

export type MemoryProviderDelegationParams = {
  config?: OpenClawConfig;
  parentSessionKey?: string;
  childSessionKey: string;
  workspaceDir?: string;
  ttlMs?: number;
};

export type MemoryProviderDelegationEndParams = {
  config?: OpenClawConfig;
  childSessionKey: string;
  reason: SubagentEndReason;
  workspaceDir?: string;
};

export type MemoryStewardSessionEndParams = {
  sessionKey: string;
  agentId: string;
  workspaceDir: string;
  entry: SessionEntry;
  curateLimit?: string;
  incubateLimit?: string;
  promoteLimit?: string;
  minCandidates?: string;
};

export type MemoryStewardSessionEndResult = {
  keptSessions: number;
  memoryCandidates: number;
  skillCandidates: number;
};

export type MemoryProviderKernel = {
  id: MemoryProviderKernelId;
  systemPromptBlock: (params: MemoryProviderSystemPromptParams) => string[];
  resolveFlushPlan: typeof resolveMemoryFlushPlan;
  prefetch: (
    params: MemoryProviderPrefetchParams,
  ) => ReturnType<typeof getActiveMemorySearchManager>;
  resolveBackendConfig: (
    params: MemoryProviderBackendConfigParams,
  ) => ReturnType<typeof resolveActiveMemoryBackendConfig>;
  bootstrap: (
    params: MemoryProviderBootstrapParams,
  ) => ReturnType<typeof runAttemptContextEngineBootstrap>;
  syncTurn: (
    params: MemoryProviderTurnSyncParams,
  ) => ReturnType<typeof finalizeAttemptContextEngineTurn>;
  maintain: (
    params: MemoryProviderMaintenanceParams,
  ) => ReturnType<typeof runContextEngineMaintenance>;
  prepareDelegation: (
    params: MemoryProviderDelegationParams,
  ) => Promise<SubagentSpawnPreparation | undefined>;
  onDelegationEnded: (params: MemoryProviderDelegationEndParams) => Promise<void>;
  runSessionStewardCycle: (
    params: MemoryStewardSessionEndParams,
  ) => Promise<MemoryStewardSessionEndResult>;
  shutdown: (cfg?: OpenClawConfig) => Promise<void>;
};

function createSilentRuntime(): RuntimeEnv {
  return {
    log: () => {},
    error: (value: unknown) => {
      throw new Error(String(value));
    },
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
  };
}

async function resolveMemoryProviderContextEngine(params: {
  config?: OpenClawConfig;
  workspaceDir?: string;
}): Promise<ContextEngine> {
  const [
    { loadConfig },
    { ensureRuntimePluginsLoaded },
    { ensureContextEnginesInitialized },
    { resolveContextEngine },
  ] = await Promise.all([
    import("../config/config.js"),
    import("./runtime-plugins.js"),
    import("../context-engine/init.js"),
    import("../context-engine/registry.js"),
  ]);

  const cfg = params.config ?? loadConfig();
  ensureRuntimePluginsLoaded({
    config: cfg,
    workspaceDir: params.workspaceDir,
    allowGatewaySubagentBinding: true,
  });
  ensureContextEnginesInitialized();
  return await resolveContextEngine(cfg);
}

export async function prepareMemoryProviderDelegation(
  params: MemoryProviderDelegationParams,
): Promise<SubagentSpawnPreparation | undefined> {
  const parentSessionKey = params.parentSessionKey?.trim();
  if (!parentSessionKey) {
    return undefined;
  }

  try {
    const engine = await resolveMemoryProviderContextEngine({
      config: params.config,
      workspaceDir: params.workspaceDir,
    });
    if (!engine.prepareSubagentSpawn) {
      return undefined;
    }
    return await engine.prepareSubagentSpawn({
      parentSessionKey,
      childSessionKey: params.childSessionKey,
      ...(params.ttlMs !== undefined ? { ttlMs: params.ttlMs } : {}),
    });
  } catch (err) {
    log.warn("memory provider prepareDelegation failed (best-effort)", { err });
    return undefined;
  }
}

export async function notifyMemoryProviderDelegationEnded(
  params: MemoryProviderDelegationEndParams,
): Promise<void> {
  try {
    const engine = await resolveMemoryProviderContextEngine({
      config: params.config,
      workspaceDir: params.workspaceDir,
    });
    if (!engine.onSubagentEnded) {
      return;
    }
    await engine.onSubagentEnded({
      childSessionKey: params.childSessionKey,
      reason: params.reason,
      ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    } as never);
  } catch (err) {
    log.warn("memory provider onDelegationEnded failed (best-effort)", { err });
  }
}

export async function runMemoryStewardSessionEnd(
  params: MemoryStewardSessionEndParams,
): Promise<MemoryStewardSessionEndResult> {
  const runtime = createSilentRuntime();
  const {
    stewardCurateCommand,
    stewardIngestExplicitSession,
    stewardIncubateSkillsCommand,
    stewardMaintainCommand,
    stewardPromoteSkillsCommand,
  } = await import("../commands/steward.js");

  const ingest = await stewardIngestExplicitSession({
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    entry: params.entry,
    apply: true,
  });

  if (ingest.keptSessions === 0) {
    return {
      keptSessions: ingest.keptSessions,
      memoryCandidates: ingest.memoryCandidates,
      skillCandidates: ingest.skillCandidates,
    };
  }

  await stewardCurateCommand(
    {
      workspace: params.workspaceDir,
      agent: params.agentId,
      limit: params.curateLimit ?? String(DEFAULT_MEMORY_STEWARD_CURATE_LIMIT),
      apply: true,
    },
    runtime,
  );
  await stewardMaintainCommand(
    {
      workspace: params.workspaceDir,
      agent: params.agentId,
      apply: true,
    },
    runtime,
  );
  await stewardIncubateSkillsCommand(
    {
      workspace: params.workspaceDir,
      agent: params.agentId,
      limit: params.incubateLimit ?? String(DEFAULT_MEMORY_STEWARD_INCUBATE_LIMIT),
      apply: true,
    },
    runtime,
  );
  await stewardPromoteSkillsCommand(
    {
      workspace: params.workspaceDir,
      agent: params.agentId,
      limit: params.promoteLimit ?? String(DEFAULT_MEMORY_STEWARD_PROMOTE_LIMIT),
      minCandidates: params.minCandidates ?? String(DEFAULT_MEMORY_STEWARD_MIN_CANDIDATES),
      apply: true,
    },
    runtime,
  );

  return {
    keptSessions: ingest.keptSessions,
    memoryCandidates: ingest.memoryCandidates,
    skillCandidates: ingest.skillCandidates,
  };
}

const defaultMemoryProviderKernel: MemoryProviderKernel = {
  id: DEFAULT_MEMORY_PROVIDER_KERNEL_ID,
  systemPromptBlock: (params) =>
    buildMemoryPromptSection({
      availableTools: params.availableTools,
      ...(params.citationsMode !== undefined ? { citationsMode: params.citationsMode } : {}),
    }),
  resolveFlushPlan: (params) => resolveMemoryFlushPlan(params),
  prefetch: async (params) => await getActiveMemorySearchManager(params),
  resolveBackendConfig: (params) => resolveActiveMemoryBackendConfig(params),
  bootstrap: async (params) => await runAttemptContextEngineBootstrap(params),
  syncTurn: async (params) => await finalizeAttemptContextEngineTurn(params),
  maintain: async (params) => await runContextEngineMaintenance(params),
  prepareDelegation: async (params) => await prepareMemoryProviderDelegation(params),
  onDelegationEnded: async (params) => await notifyMemoryProviderDelegationEnded(params),
  runSessionStewardCycle: async (params) => await runMemoryStewardSessionEnd(params),
  shutdown: async (cfg) => await closeActiveMemorySearchManagers(cfg),
};

export function resolveDefaultMemoryProviderKernel(): MemoryProviderKernel {
  return defaultMemoryProviderKernel;
}
