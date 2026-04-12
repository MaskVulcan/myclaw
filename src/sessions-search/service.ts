import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import {
  loadKnowledgeReviewRecord,
  type KnowledgeReviewRecord,
} from "../agents/knowledge-review-store.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreTargets,
  type SessionEntry,
  type SessionStoreSelectionOptions,
  type SessionStoreTarget,
} from "../config/sessions.js";
import {
  readSessionPreviewItemsFromTranscript,
  readSessionTitleFieldsFromTranscript,
} from "../gateway/session-utils.js";
import type { MemorySearchResult } from "../plugin-sdk/memory-core-host-engine-storage.js";
import { getActiveMemorySearchManager } from "../plugins/memory-runtime.js";

const DEFAULT_SESSION_RESULT_LIMIT = 5;
const DEFAULT_SESSION_HITS_PER_RESULT = 2;
const MAX_SESSION_RESULT_LIMIT = 20;
const MAX_SESSION_HITS_PER_RESULT = 5;
const MAX_SESSION_RAW_HITS = 80;

export type SessionSearchHit = MemorySearchResult & {
  citation: string;
};

export type SessionSearchResult = {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  updatedAt: number | null;
  title: string;
  summary?: string;
  previewItems: string[];
  tags: string[];
  hitCount: number;
  maxScore: number;
  hits: SessionSearchHit[];
};

export type SessionSearchWarning = {
  agentId: string;
  message: string;
};

export type SearchSessionsParams = SessionStoreSelectionOptions & {
  cfg: OpenClawConfig;
  query: string;
  maxResults?: number;
  maxHitsPerSession?: number;
  minScore?: number;
  requesterSessionKey?: string;
  filterSessionKey?: (sessionKey: string) => boolean | Promise<boolean>;
};

export type SearchSessionsResult = {
  query: string;
  targets: Array<{ agentId: string; storePath: string }>;
  disabled: boolean;
  warnings: SessionSearchWarning[];
  results: SessionSearchResult[];
};

type SessionSearchMeta = {
  agentId: string;
  sessionKey: string;
  sessionId: string;
  updatedAt: number | null;
  entry: SessionEntry;
  storePath: string;
};

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  const normalized = normalizePreviewText(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function extractSessionIdFromHitPath(hitPath: string): string | null {
  const normalized = hitPath.trim().replace(/\\/g, "/");
  if (!normalized.startsWith("sessions/") || !normalized.endsWith(".jsonl")) {
    return null;
  }
  const base = path.basename(normalized, ".jsonl").trim();
  return base || null;
}

function buildCitation(hit: MemorySearchResult): string {
  const start = Math.max(1, Math.floor(hit.startLine));
  const end = Math.max(start, Math.floor(hit.endLine));
  return `${hit.path}:${start}-${end}`;
}

function buildSessionMetaIndex(target: SessionStoreTarget): Map<string, SessionSearchMeta> {
  const store = loadSessionStore(target.storePath);
  const bySessionId = new Map<string, SessionSearchMeta>();
  for (const [sessionKey, entry] of Object.entries(store)) {
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId.trim() : "";
    if (!sessionId) {
      continue;
    }
    const existing = bySessionId.get(sessionId);
    const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : null;
    if ((existing?.updatedAt ?? 0) > (updatedAt ?? 0)) {
      continue;
    }
    bySessionId.set(sessionId, {
      agentId: target.agentId,
      sessionKey,
      sessionId,
      updatedAt,
      entry,
      storePath: target.storePath,
    });
  }
  return bySessionId;
}

async function resolveSessionDecoration(params: {
  cfg: OpenClawConfig;
  meta: SessionSearchMeta;
}): Promise<{
  title: string;
  summary?: string;
  previewItems: string[];
  tags: string[];
}> {
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.meta.agentId);
  const review = await loadKnowledgeReviewRecord(workspaceDir, params.meta.sessionId);
  return buildSessionDecorationFromReview(params.meta, review);
}

function buildSessionDecorationFromReview(
  meta: SessionSearchMeta,
  review: KnowledgeReviewRecord | null,
): {
  title: string;
  summary?: string;
  previewItems: string[];
  tags: string[];
} {
  if (review) {
    return {
      title: review.title,
      summary: review.summary || undefined,
      previewItems: review.previewItems.slice(0, 3),
      tags: review.tags.slice(0, 6),
    };
  }

  const titleFields = readSessionTitleFieldsFromTranscript(
    meta.sessionId,
    meta.storePath,
    meta.entry.sessionFile,
    meta.agentId,
  );
  const previewItems = readSessionPreviewItemsFromTranscript(
    meta.sessionId,
    meta.storePath,
    meta.entry.sessionFile,
    meta.agentId,
    3,
    140,
  )
    .map((item) => normalizePreviewText(item.text))
    .filter(Boolean)
    .slice(0, 3);
  const title =
    titleFields.firstUserMessage?.trim() ||
    titleFields.lastMessagePreview?.trim() ||
    previewItems[0] ||
    meta.entry.displayName?.trim() ||
    meta.entry.subject?.trim() ||
    meta.sessionId;
  const summary =
    titleFields.lastMessagePreview?.trim() ||
    titleFields.firstUserMessage?.trim() ||
    previewItems[0];
  return {
    title: truncate(title, 80),
    summary: summary ? truncate(summary, 200) : undefined,
    previewItems,
    tags: [],
  };
}

async function searchTargetSessions(params: {
  cfg: OpenClawConfig;
  target: SessionStoreTarget;
  query: string;
  maxRawHits: number;
  minScore?: number;
  requesterSessionKey?: string;
}): Promise<
  | {
      disabled: false;
      results: Array<{ meta: SessionSearchMeta; hit: MemorySearchResult }>;
    }
  | {
      disabled: true;
      warning: SessionSearchWarning;
    }
> {
  const { manager, error } = await getActiveMemorySearchManager({
    cfg: params.cfg,
    agentId: params.target.agentId,
  });
  if (!manager) {
    return {
      disabled: true,
      warning: {
        agentId: params.target.agentId,
        message: error ?? "memory runtime unavailable",
      },
    };
  }

  const status = manager.status();
  if (!status.sources?.includes("sessions")) {
    return {
      disabled: true,
      warning: {
        agentId: params.target.agentId,
        message: "sessions source is not enabled for memory search",
      },
    };
  }

  const sessionIndex = buildSessionMetaIndex(params.target);
  const rawHits = await manager.search(params.query, {
    maxResults: params.maxRawHits,
    minScore: params.minScore,
    sessionKey: params.requesterSessionKey,
    sources: ["sessions"],
  });
  const results: Array<{ meta: SessionSearchMeta; hit: MemorySearchResult }> = [];
  for (const hit of rawHits) {
    if (hit.source !== "sessions") {
      continue;
    }
    const sessionId = extractSessionIdFromHitPath(hit.path);
    if (!sessionId) {
      continue;
    }
    const meta = sessionIndex.get(sessionId);
    if (!meta) {
      continue;
    }
    results.push({ meta, hit });
  }
  return { disabled: false, results };
}

export async function searchSessions(params: SearchSessionsParams): Promise<SearchSessionsResult> {
  const query = params.query.trim();
  const targets = resolveSessionStoreTargets(params.cfg, {
    store: params.store,
    agent: params.agent,
    allAgents: params.allAgents,
  });
  const maxResults = clampPositive(
    params.maxResults,
    DEFAULT_SESSION_RESULT_LIMIT,
    MAX_SESSION_RESULT_LIMIT,
  );
  const maxHitsPerSession = clampPositive(
    params.maxHitsPerSession,
    DEFAULT_SESSION_HITS_PER_RESULT,
    MAX_SESSION_HITS_PER_RESULT,
  );
  const maxRawHits = Math.min(MAX_SESSION_RAW_HITS, maxResults * maxHitsPerSession * 4);

  const warnings: SessionSearchWarning[] = [];
  const visibilityCache = new Map<string, boolean>();
  const grouped = new Map<string, SessionSearchResult>();

  const targetResults = await Promise.all(
    targets.map(
      async (target) =>
        await searchTargetSessions({
          cfg: params.cfg,
          target,
          query,
          maxRawHits,
          minScore: params.minScore,
          requesterSessionKey: params.requesterSessionKey,
        }),
    ),
  );

  for (const targetResult of targetResults) {
    if (targetResult.disabled) {
      warnings.push(targetResult.warning);
      continue;
    }
    for (const entry of targetResult.results) {
      const cachedAllowed = visibilityCache.get(entry.meta.sessionKey);
      const allowed =
        cachedAllowed ??
        (params.filterSessionKey ? await params.filterSessionKey(entry.meta.sessionKey) : true);
      visibilityCache.set(entry.meta.sessionKey, allowed);
      if (!allowed) {
        continue;
      }

      const existing = grouped.get(entry.meta.sessionKey);
      const sessionHit: SessionSearchHit = {
        ...entry.hit,
        snippet: truncate(entry.hit.snippet, 220),
        citation: buildCitation(entry.hit),
      };
      if (existing) {
        existing.hitCount += 1;
        existing.maxScore = Math.max(existing.maxScore, entry.hit.score);
        existing.hits.push(sessionHit);
        continue;
      }

      const decoration = await resolveSessionDecoration({
        cfg: params.cfg,
        meta: entry.meta,
      });
      grouped.set(entry.meta.sessionKey, {
        sessionKey: entry.meta.sessionKey,
        sessionId: entry.meta.sessionId,
        agentId: entry.meta.agentId,
        updatedAt: entry.meta.updatedAt,
        title: decoration.title,
        ...(decoration.summary ? { summary: decoration.summary } : {}),
        previewItems: decoration.previewItems,
        tags: decoration.tags,
        hitCount: 1,
        maxScore: entry.hit.score,
        hits: [sessionHit],
      });
    }
  }

  const results = Array.from(grouped.values())
    .map((result) => ({
      ...result,
      hits: result.hits.toSorted((a, b) => b.score - a.score).slice(0, maxHitsPerSession),
    }))
    .toSorted((a, b) => b.maxScore - a.maxScore || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, maxResults);

  return {
    query,
    targets: targets.map((target) => ({ agentId: target.agentId, storePath: target.storePath })),
    disabled: results.length === 0 && warnings.length === targets.length && targets.length > 0,
    warnings,
    results,
  };
}
