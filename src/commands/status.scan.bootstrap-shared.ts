import type { OpenClawConfig } from "../config/types.js";
import type { UpdateCheckResult } from "../infra/update-check.js";
import { runExec } from "../process/exec.js";
import { buildTailscaleHttpsUrl, resolveGatewayProbeSnapshot } from "./status.scan.shared.js";

function createEmptyTaskRegistrySummary() {
  return {
    total: 0,
    active: 0,
    terminal: 0,
    failures: 0,
    byStatus: {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      timed_out: 0,
      cancelled: 0,
      lost: 0,
    },
    byRuntime: {
      subagent: 0,
      acp: 0,
      cli: 0,
      cron: 0,
    },
  };
}

function createEmptyTaskAuditSummary() {
  return {
    total: 0,
    warnings: 0,
    errors: 0,
    byCode: {
      stale_queued: 0,
      stale_running: 0,
      lost: 0,
      delivery_failed: 0,
      missing_cleanup: 0,
      inconsistent_timestamps: 0,
    },
  };
}

export function buildColdStartUpdateResult(): UpdateCheckResult {
  return {
    root: null,
    installKind: "unknown",
    packageManager: "unknown",
  };
}

export function buildColdStartAgentLocalStatuses() {
  return {
    defaultId: "main",
    agents: [],
    totalSessions: 0,
    bootstrapPendingCount: 0,
  };
}

export function buildColdStartStatusSummary() {
  return {
    runtimeVersion: null,
    heartbeat: {
      defaultAgentId: "main",
      agents: [],
    },
    channelSummary: [],
    queuedSystemEvents: [],
    tasks: createEmptyTaskRegistrySummary(),
    taskAudit: createEmptyTaskAuditSummary(),
    sessions: {
      paths: [],
      count: 0,
      defaults: { model: null, contextTokens: null },
      recent: [],
      byAgent: [],
    },
  };
}

export function shouldSkipStatusScanNetworkChecks(params: {
  coldStart: boolean;
  hasConfiguredChannels: boolean;
  all?: boolean;
}): boolean {
  return params.coldStart && !params.hasConfiguredChannels && params.all !== true;
}

type StatusScanExecRunner = (
  command: string,
  args: string[],
  opts?: number | { timeoutMs?: number; maxBuffer?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export async function createStatusScanCoreBootstrap<TAgentStatus>(params: {
  coldStart: boolean;
  cfg: OpenClawConfig;
  hasConfiguredChannels: boolean;
  opts: { timeoutMs?: number; all?: boolean };
  getTailnetHostname: (runner: StatusScanExecRunner) => Promise<string | null>;
  getUpdateCheckResult: (params: {
    timeoutMs: number;
    fetchGit: boolean;
    includeRegistry: boolean;
  }) => Promise<UpdateCheckResult>;
  getAgentLocalStatuses: (cfg: OpenClawConfig) => Promise<TAgentStatus>;
}) {
  const tailscaleMode = params.cfg.gateway?.tailscale?.mode ?? "off";
  const skipColdStartNetworkChecks = shouldSkipStatusScanNetworkChecks({
    coldStart: params.coldStart,
    hasConfiguredChannels: params.hasConfiguredChannels,
    all: params.opts.all,
  });
  const updateTimeoutMs = params.opts.all ? 6500 : 2500;
  const tailscaleDnsPromise =
    tailscaleMode === "off"
      ? Promise.resolve<string | null>(null)
      : params
          .getTailnetHostname((cmd, args) =>
            runExec(cmd, args, { timeoutMs: 1200, maxBuffer: 200_000 }),
          )
          .catch(() => null);
  const updatePromise = skipColdStartNetworkChecks
    ? Promise.resolve(buildColdStartUpdateResult())
    : params.getUpdateCheckResult({
        timeoutMs: updateTimeoutMs,
        fetchGit: true,
        includeRegistry: true,
      });
  const agentStatusPromise = skipColdStartNetworkChecks
    ? Promise.resolve(buildColdStartAgentLocalStatuses() as TAgentStatus)
    : params.getAgentLocalStatuses(params.cfg);
  const gatewayProbePromise = resolveGatewayProbeSnapshot({
    cfg: params.cfg,
    opts: {
      ...params.opts,
      ...(skipColdStartNetworkChecks ? { skipProbe: true } : {}),
    },
  });

  return {
    tailscaleMode,
    tailscaleDnsPromise,
    updatePromise,
    agentStatusPromise,
    gatewayProbePromise,
    skipColdStartNetworkChecks,
    resolveTailscaleHttpsUrl: async () =>
      buildTailscaleHttpsUrl({
        tailscaleMode,
        tailscaleDns: await tailscaleDnsPromise,
        controlUiBasePath: params.cfg.gateway?.controlUi?.basePath,
      }),
  };
}

export async function createStatusScanBootstrap<TAgentStatus, TSummary>(params: {
  coldStart: boolean;
  cfg: OpenClawConfig;
  sourceConfig: OpenClawConfig;
  hasConfiguredChannels: boolean;
  opts: { timeoutMs?: number; all?: boolean };
  getTailnetHostname: (runner: StatusScanExecRunner) => Promise<string | null>;
  getUpdateCheckResult: (params: {
    timeoutMs: number;
    fetchGit: boolean;
    includeRegistry: boolean;
  }) => Promise<UpdateCheckResult>;
  getAgentLocalStatuses: (cfg: OpenClawConfig) => Promise<TAgentStatus>;
  getStatusSummary: (params: {
    config: OpenClawConfig;
    sourceConfig: OpenClawConfig;
  }) => Promise<TSummary>;
}) {
  const core = await createStatusScanCoreBootstrap<TAgentStatus>({
    coldStart: params.coldStart,
    cfg: params.cfg,
    hasConfiguredChannels: params.hasConfiguredChannels,
    opts: params.opts,
    getTailnetHostname: params.getTailnetHostname,
    getUpdateCheckResult: params.getUpdateCheckResult,
    getAgentLocalStatuses: params.getAgentLocalStatuses,
  });
  const summaryPromise = core.skipColdStartNetworkChecks
    ? Promise.resolve(buildColdStartStatusSummary() as TSummary)
    : params.getStatusSummary({
        config: params.cfg,
        sourceConfig: params.sourceConfig,
      });
  return {
    ...core,
    summaryPromise,
  };
}
