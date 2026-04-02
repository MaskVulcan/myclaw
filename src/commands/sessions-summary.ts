import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../agents/defaults.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveFreshSessionTotalTokens,
  type SessionEntry,
} from "../config/sessions.js";
import {
  classifySessionKey,
  readSessionPreviewItemsFromTranscript,
  readSessionTitleFieldsFromTranscript,
} from "../gateway/session-utils.js";
import type { SessionPreviewItem } from "../gateway/session-utils.types.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { formatTokenCount, formatUsd } from "../utils/usage-format.js";
import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";
import { resolveSessionDisplayDefaults, resolveSessionDisplayModel } from "./sessions-table.js";

type SessionKind = "direct" | "group" | "global" | "unknown";

type SessionSummaryOptions = {
  json?: boolean;
  store?: string;
  active?: string;
  agent?: string;
  allAgents?: boolean;
  recent?: string;
};

type SessionSummaryRow = {
  key: string;
  agentId: string;
  kind: SessionKind;
  updatedAt: number | null;
  sessionId?: string;
  sessionFile?: string;
  storePath: string;
  model: string;
  contextTokens: number | null;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

type SummaryBucket = {
  label: string;
  count: number;
  knownTokens: number;
  sessionsWithKnownTokens: number;
  estimatedCostUsd: number;
  sessionsWithEstimatedCost: number;
};

type RecentSessionSummary = {
  key: string;
  agentId: string;
  kind: SessionKind;
  updatedAt: number | null;
  model: string;
  totalTokens: number | null;
  contextTokens: number | null;
  previewItems: SessionPreviewItem[];
  firstUserMessage: string | null;
  lastMessagePreview: string | null;
};

type SummaryTotals = {
  sessions: number;
  knownTokens: number;
  sessionsWithKnownTokens: number;
  estimatedCostUsd: number;
  sessionsWithEstimatedCost: number;
};

type SummaryActivity = {
  last60m: number;
  last24h: number;
  last7d: number;
};

const DEFAULT_RECENT_LIMIT = 5;
const RECENT_PREVIEW_ITEMS = 2;
const RECENT_PREVIEW_CHARS = 120;

const BUCKET_LABEL_PAD = 18;
const BUCKET_COUNT_PAD = 5;
const BUCKET_TOKENS_PAD = 8;
const BUCKET_COST_PAD = 8;

function parsePositiveIntOption(
  raw: string | undefined,
  runtime: RuntimeEnv,
  flag: "--active",
): number | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    runtime.error(`${flag} must be a positive integer (minutes)`);
    runtime.exit(1);
    return null;
  }
  return parsed;
}

function parseRecentLimit(raw: string | undefined, runtime: RuntimeEnv): number | null {
  if (raw === undefined) {
    return DEFAULT_RECENT_LIMIT;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    runtime.error("--recent must be a non-negative integer");
    runtime.exit(1);
    return null;
  }
  return parsed;
}

function sanitizeEstimatedCostUsd(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function createSummaryBucket(label: string): SummaryBucket {
  return {
    label,
    count: 0,
    knownTokens: 0,
    sessionsWithKnownTokens: 0,
    estimatedCostUsd: 0,
    sessionsWithEstimatedCost: 0,
  };
}

function addRowToBucket(bucket: SummaryBucket, row: SessionSummaryRow): void {
  bucket.count += 1;
  if (row.totalTokens !== undefined) {
    bucket.knownTokens += row.totalTokens;
    bucket.sessionsWithKnownTokens += 1;
  }
  if (row.estimatedCostUsd !== undefined) {
    bucket.estimatedCostUsd += row.estimatedCostUsd;
    bucket.sessionsWithEstimatedCost += 1;
  }
}

function sortSummaryBuckets(a: SummaryBucket, b: SummaryBucket): number {
  return (
    b.count - a.count ||
    b.knownTokens - a.knownTokens ||
    b.estimatedCostUsd - a.estimatedCostUsd ||
    a.label.localeCompare(b.label)
  );
}

function buildSessionSummaryRow(params: {
  key: string;
  entry: SessionEntry;
  storePath: string;
  fallbackAgentId: string;
  cfg: ReturnType<typeof loadConfig>;
  defaults: ReturnType<typeof resolveSessionDisplayDefaults>;
  configContextTokens: number;
}): SessionSummaryRow {
  const agentId = parseAgentSessionKey(params.key)?.agentId ?? params.fallbackAgentId;
  const model = resolveSessionDisplayModel(
    params.cfg,
    {
      key: params.key,
      model: params.entry.model,
      modelProvider: params.entry.modelProvider,
      modelOverride: params.entry.modelOverride,
      providerOverride: params.entry.providerOverride,
    },
    params.defaults,
  );
  return {
    key: params.key,
    agentId,
    kind: classifySessionKey(params.key, params.entry),
    updatedAt: params.entry.updatedAt ?? null,
    sessionId: params.entry.sessionId,
    sessionFile: params.entry.sessionFile,
    storePath: params.storePath,
    model,
    contextTokens:
      params.entry.contextTokens ??
      lookupContextTokens(model) ??
      params.configContextTokens ??
      DEFAULT_CONTEXT_TOKENS,
    totalTokens: resolveFreshSessionTotalTokens(params.entry),
    estimatedCostUsd: sanitizeEstimatedCostUsd(params.entry.estimatedCostUsd),
  };
}

function buildTotals(rows: SessionSummaryRow[]): SummaryTotals {
  let knownTokens = 0;
  let sessionsWithKnownTokens = 0;
  let estimatedCostUsd = 0;
  let sessionsWithEstimatedCost = 0;

  for (const row of rows) {
    if (row.totalTokens !== undefined) {
      knownTokens += row.totalTokens;
      sessionsWithKnownTokens += 1;
    }
    if (row.estimatedCostUsd !== undefined) {
      estimatedCostUsd += row.estimatedCostUsd;
      sessionsWithEstimatedCost += 1;
    }
  }

  return {
    sessions: rows.length,
    knownTokens,
    sessionsWithKnownTokens,
    estimatedCostUsd,
    sessionsWithEstimatedCost,
  };
}

function buildActivity(rows: SessionSummaryRow[]): SummaryActivity {
  const now = Date.now();
  const countWithin = (minutes: number) =>
    rows.filter((row) => row.updatedAt !== null && now - row.updatedAt <= minutes * 60_000).length;
  return {
    last60m: countWithin(60),
    last24h: countWithin(24 * 60),
    last7d: countWithin(7 * 24 * 60),
  };
}

function buildBucketArray(
  rows: SessionSummaryRow[],
  selectLabel: (row: SessionSummaryRow) => string,
): SummaryBucket[] {
  const buckets = new Map<string, SummaryBucket>();
  for (const row of rows) {
    const label = selectLabel(row);
    const bucket = buckets.get(label) ?? createSummaryBucket(label);
    addRowToBucket(bucket, row);
    buckets.set(label, bucket);
  }
  return [...buckets.values()].toSorted(sortSummaryBuckets);
}

function buildRecentSessionSummary(row: SessionSummaryRow): RecentSessionSummary {
  if (!row.sessionId) {
    return {
      key: row.key,
      agentId: row.agentId,
      kind: row.kind,
      updatedAt: row.updatedAt,
      model: row.model,
      totalTokens: row.totalTokens ?? null,
      contextTokens: row.contextTokens,
      previewItems: [],
      firstUserMessage: null,
      lastMessagePreview: null,
    };
  }

  const previewItems = readSessionPreviewItemsFromTranscript(
    row.sessionId,
    row.storePath,
    row.sessionFile,
    row.agentId,
    RECENT_PREVIEW_ITEMS,
    RECENT_PREVIEW_CHARS,
  );
  const titleFields =
    previewItems.length > 0
      ? { firstUserMessage: null, lastMessagePreview: null }
      : readSessionTitleFieldsFromTranscript(
          row.sessionId,
          row.storePath,
          row.sessionFile,
          row.agentId,
        );

  return {
    key: row.key,
    agentId: row.agentId,
    kind: row.kind,
    updatedAt: row.updatedAt,
    model: row.model,
    totalTokens: row.totalTokens ?? null,
    contextTokens: row.contextTokens,
    previewItems,
    firstUserMessage: titleFields.firstUserMessage,
    lastMessagePreview: titleFields.lastMessagePreview,
  };
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatBucketLine(bucket: SummaryBucket): string {
  const tokensLabel =
    bucket.sessionsWithKnownTokens > 0
      ? formatTokenCount(bucket.knownTokens).padStart(BUCKET_TOKENS_PAD)
      : "-".padStart(BUCKET_TOKENS_PAD);
  const costLabel =
    bucket.sessionsWithEstimatedCost > 0
      ? (formatUsd(bucket.estimatedCostUsd) ?? "-").padStart(BUCKET_COST_PAD)
      : "-".padStart(BUCKET_COST_PAD);
  return [
    bucket.label.padEnd(BUCKET_LABEL_PAD),
    String(bucket.count).padStart(BUCKET_COUNT_PAD),
    tokensLabel,
    costLabel,
  ].join(" ");
}

function formatRecentPreviewLines(entry: RecentSessionSummary): string[] {
  if (entry.previewItems.length > 0) {
    return entry.previewItems.map((item) => `  ${item.role}: ${normalizePreviewText(item.text)}`);
  }

  const lines: string[] = [];
  if (entry.firstUserMessage) {
    lines.push(`  start: ${normalizePreviewText(entry.firstUserMessage)}`);
  }
  if (
    entry.lastMessagePreview &&
    normalizePreviewText(entry.lastMessagePreview) !==
      normalizePreviewText(entry.firstUserMessage ?? "")
  ) {
    lines.push(`  last: ${normalizePreviewText(entry.lastMessagePreview)}`);
  }
  return lines;
}

function emitBucketSection(runtime: RuntimeEnv, title: string, buckets: SummaryBucket[]): void {
  runtime.log("");
  runtime.log(title);
  runtime.log(
    [
      "Label".padEnd(BUCKET_LABEL_PAD),
      "Count".padStart(BUCKET_COUNT_PAD),
      "Tokens".padStart(BUCKET_TOKENS_PAD),
      "Cost".padStart(BUCKET_COST_PAD),
    ].join(" "),
  );
  for (const bucket of buckets) {
    runtime.log(formatBucketLine(bucket));
  }
}

export async function sessionsSummaryCommand(opts: SessionSummaryOptions, runtime: RuntimeEnv) {
  const activeMinutes = parsePositiveIntOption(opts.active, runtime, "--active");
  if (activeMinutes === null) {
    return;
  }

  const recentLimit = parseRecentLimit(opts.recent, runtime);
  if (recentLimit === null) {
    return;
  }

  const aggregateAgents = opts.allAgents === true;
  const cfg = loadConfig();
  const defaults = resolveSessionDisplayDefaults(cfg);
  const configContextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(defaults.model) ??
    DEFAULT_CONTEXT_TOKENS;
  const targets = resolveSessionStoreTargetsOrExit({
    cfg,
    opts: {
      store: opts.store,
      agent: opts.agent,
      allAgents: opts.allAgents,
    },
    runtime,
  });
  if (!targets) {
    return;
  }

  const allRows = targets
    .flatMap((target) => {
      const store = loadSessionStore(target.storePath);
      return Object.entries(store).map(([key, entry]) =>
        buildSessionSummaryRow({
          key,
          entry,
          storePath: target.storePath,
          fallbackAgentId: target.agentId,
          cfg,
          defaults,
          configContextTokens,
        }),
      );
    })
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const scopeRows =
    activeMinutes === undefined
      ? allRows
      : allRows.filter((row) => {
          if (row.updatedAt === null) {
            return false;
          }
          return Date.now() - row.updatedAt <= activeMinutes * 60_000;
        });

  const totals = buildTotals(scopeRows);
  const activity = buildActivity(scopeRows);
  const kindBuckets = buildBucketArray(scopeRows, (row) => row.kind);
  const agentBuckets = buildBucketArray(scopeRows, (row) => row.agentId);
  const modelBuckets = buildBucketArray(scopeRows, (row) => row.model);
  const recent = scopeRows.slice(0, recentLimit).map(buildRecentSessionSummary);

  if (opts.json) {
    const aggregate = aggregateAgents || targets.length > 1;
    writeRuntimeJson(runtime, {
      path: aggregate ? null : (targets[0]?.storePath ?? null),
      stores: aggregate
        ? targets.map((target) => ({
            agentId: target.agentId,
            path: target.storePath,
          }))
        : undefined,
      allAgents: aggregateAgents ? true : undefined,
      scannedCount: allRows.length,
      count: scopeRows.length,
      activeMinutes: activeMinutes ?? null,
      recentLimit,
      activity,
      totals,
      kinds: kindBuckets.map((bucket) => ({
        kind: bucket.label,
        count: bucket.count,
        knownTokens: bucket.knownTokens,
        sessionsWithKnownTokens: bucket.sessionsWithKnownTokens,
        estimatedCostUsd: bucket.estimatedCostUsd,
        sessionsWithEstimatedCost: bucket.sessionsWithEstimatedCost,
      })),
      agents: agentBuckets.map((bucket) => ({
        agentId: bucket.label,
        count: bucket.count,
        knownTokens: bucket.knownTokens,
        sessionsWithKnownTokens: bucket.sessionsWithKnownTokens,
        estimatedCostUsd: bucket.estimatedCostUsd,
        sessionsWithEstimatedCost: bucket.sessionsWithEstimatedCost,
      })),
      models: modelBuckets.map((bucket) => ({
        model: bucket.label,
        count: bucket.count,
        knownTokens: bucket.knownTokens,
        sessionsWithKnownTokens: bucket.sessionsWithKnownTokens,
        estimatedCostUsd: bucket.estimatedCostUsd,
        sessionsWithEstimatedCost: bucket.sessionsWithEstimatedCost,
      })),
      recent,
    });
    return;
  }

  if (targets.length === 1 && !aggregateAgents) {
    runtime.log(`Session store: ${targets[0]?.storePath}`);
  } else {
    runtime.log(
      `Session stores: ${targets.length} (${targets.map((target) => target.agentId).join(", ")})`,
    );
  }
  runtime.log(`Sessions analyzed: ${scopeRows.length}`);
  if (activeMinutes !== undefined) {
    runtime.log(
      `Filtered from ${allRows.length} total sessions to last ${activeMinutes} minute(s)`,
    );
  }
  if (scopeRows.length === 0) {
    runtime.log(
      allRows.length === 0 ? "No sessions found." : "No sessions matched the current filters.",
    );
    return;
  }

  runtime.log(
    `Recent activity: 1h ${activity.last60m} | 24h ${activity.last24h} | 7d ${activity.last7d}`,
  );
  runtime.log(
    `Known token usage: ${formatTokenCount(totals.knownTokens)} across ${totals.sessionsWithKnownTokens}/${scopeRows.length} session(s)`,
  );
  runtime.log(
    `Estimated cost: ${
      totals.sessionsWithEstimatedCost > 0 ? (formatUsd(totals.estimatedCostUsd) ?? "n/a") : "n/a"
    } across ${totals.sessionsWithEstimatedCost}/${scopeRows.length} session(s)`,
  );

  emitBucketSection(runtime, "Top models", modelBuckets.slice(0, 5));
  emitBucketSection(runtime, "Top agents", agentBuckets.slice(0, 5));
  emitBucketSection(runtime, "Session kinds", kindBuckets);

  if (recent.length === 0) {
    return;
  }

  runtime.log("");
  runtime.log("Recent sessions");
  for (const entry of recent) {
    const age = entry.updatedAt === null ? "unknown" : formatTimeAgo(Date.now() - entry.updatedAt);
    runtime.log(
      [
        "-",
        `[${entry.agentId}]`,
        entry.kind,
        entry.key,
        age,
        entry.model,
        entry.totalTokens !== null ? formatTokenCount(entry.totalTokens) : "unknown",
      ].join(" "),
    );
    for (const line of formatRecentPreviewLines(entry)) {
      runtime.log(line);
    }
  }
}
