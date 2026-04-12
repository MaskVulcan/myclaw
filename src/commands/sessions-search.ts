import { loadConfig } from "../config/config.js";
import { info, warn } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { searchSessions } from "../sessions-search/service.js";
import { theme } from "../terminal/theme.js";

type SessionsSearchOptions = {
  query?: string;
  json?: boolean;
  store?: string;
  agent?: string;
  allAgents?: boolean;
  maxResults?: string;
  maxHitsPerSession?: string;
  minScore?: string;
};

function parsePositiveIntOption(
  raw: string | undefined,
  runtime: RuntimeEnv,
  flag: string,
): number | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    runtime.error(`${flag} must be a positive integer`);
    runtime.exit(1);
    return null;
  }
  return parsed;
}

function parseMinScoreOption(
  raw: string | undefined,
  runtime: RuntimeEnv,
): number | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    runtime.error("--min-score must be a number between 0 and 1");
    runtime.exit(1);
    return null;
  }
  return parsed;
}

export async function sessionsSearchCommand(opts: SessionsSearchOptions, runtime: RuntimeEnv) {
  const query = opts.query?.trim();
  if (!query) {
    runtime.error("query is required");
    runtime.exit(1);
    return;
  }

  const maxResults = parsePositiveIntOption(opts.maxResults, runtime, "--max-results");
  if (maxResults === null) {
    return;
  }
  const maxHitsPerSession = parsePositiveIntOption(
    opts.maxHitsPerSession,
    runtime,
    "--max-hits-per-session",
  );
  if (maxHitsPerSession === null) {
    return;
  }
  const minScore = parseMinScoreOption(opts.minScore, runtime);
  if (minScore === null) {
    return;
  }

  const cfg = loadConfig();
  let result;
  try {
    result = await searchSessions({
      cfg,
      query,
      store: opts.store,
      agent: opts.agent,
      allAgents: opts.allAgents,
      maxResults,
      maxHitsPerSession,
      minScore,
    });
  } catch (err) {
    runtime.error(err instanceof Error ? err.message : String(err));
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }

  runtime.log(info(`Session search query: ${query}`));
  runtime.log(
    info(`Targets: ${result.targets.map((target) => target.agentId).join(", ") || "(none)"}`),
  );

  for (const warningEntry of result.warnings) {
    runtime.log(warn(`[${warningEntry.agentId}] ${warningEntry.message}`));
  }

  if (result.results.length === 0) {
    runtime.log(result.disabled ? "Session search is unavailable." : "No matching sessions found.");
    return;
  }

  runtime.log(theme.heading(`Matched sessions: ${result.results.length}`));
  for (const [index, entry] of result.results.entries()) {
    const updatedLabel = entry.updatedAt ? formatTimeAgo(entry.updatedAt) : "unknown";
    runtime.log(
      `${index + 1}. ${entry.title} ${theme.muted(`(${entry.sessionKey})`)} ${theme.muted(
        `score=${entry.maxScore.toFixed(2)} updated=${updatedLabel}`,
      )}`,
    );
    if (entry.summary) {
      runtime.log(`   summary: ${entry.summary}`);
    }
    if (entry.previewItems[0]) {
      runtime.log(`   preview: ${entry.previewItems[0]}`);
    }
    for (const hit of entry.hits) {
      runtime.log(`   - ${hit.citation} (${hit.score.toFixed(2)}): ${hit.snippet}`);
    }
  }
}
