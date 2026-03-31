#!/usr/bin/env node

import {
  defaultOxlintThreads,
  hasFlag,
  insertArgsBeforeDoubleDash,
  parseBooleanEnv,
  parseNonNegativeIntEnv,
  parsePositiveIntEnv,
  resolveToolCommand,
  runBoundedCommand,
} from "./lib/run-bounded-command.mjs";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 60_000;

function toExitCode(result) {
  if (result.code != null) {
    return result.code;
  }
  return result.timedOut ? 124 : 1;
}

function withDefaultThreads(args, threads) {
  return hasFlag(args, "--threads")
    ? [...args]
    : insertArgsBeforeDoubleDash(args, [`--threads=${threads}`]);
}

function withTypeAwareEnabled(args) {
  return hasFlag(args, "--type-aware")
    ? [...args]
    : insertArgsBeforeDoubleDash(args, ["--type-aware"]);
}

function withoutTypeAware(args) {
  return args.filter((arg) => arg !== "--type-aware");
}

async function runOxlint(command, args, timeoutMs, label) {
  return await runBoundedCommand({
    args,
    command,
    label,
    timeoutMs,
  });
}

async function main() {
  const originalArgs = process.argv.slice(2);
  const command = resolveToolCommand("oxlint", "OPENCLAW_OXLINT_BIN");
  const timeoutMs = parsePositiveIntEnv("OPENCLAW_OXLINT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const fallbackTimeoutMs = parsePositiveIntEnv(
    "OPENCLAW_OXLINT_FALLBACK_TIMEOUT_MS",
    DEFAULT_FALLBACK_TIMEOUT_MS,
  );
  const allowFallback = parseBooleanEnv("OPENCLAW_OXLINT_ALLOW_FALLBACK", true);
  const memoryPressureAllowsFallback = parseBooleanEnv(
    "OPENCLAW_OXLINT_MEMORY_PRESSURE_ALLOW_FALLBACK",
    !allowFallback,
  );
  const enableTypeAware = parseBooleanEnv("OPENCLAW_LINT_TYPE_AWARE", true);
  const threads = parsePositiveIntEnv("OPENCLAW_OXLINT_THREADS", defaultOxlintThreads());
  const minAvailableMemoryMb = parseNonNegativeIntEnv(
    "OPENCLAW_OXLINT_MIN_AVAILABLE_MB",
    !allowFallback && enableTypeAware ? 768 : 0,
  );
  const maxTreeRssMb = parseNonNegativeIntEnv(
    "OPENCLAW_OXLINT_MAX_RSS_MB",
    !allowFallback && enableTypeAware ? 2048 : 0,
  );
  const memoryPollIntervalMs = parsePositiveIntEnv("OPENCLAW_OXLINT_MEMORY_POLL_MS", 1_000);
  const memoryGuard =
    minAvailableMemoryMb > 0 || maxTreeRssMb > 0
      ? {
          enabled: true,
          maxTreeRssKb: maxTreeRssMb > 0 ? maxTreeRssMb * 1024 : 0,
          minAvailableMemoryKb: minAvailableMemoryMb > 0 ? minAvailableMemoryMb * 1024 : 0,
          pollIntervalMs: memoryPollIntervalMs,
        }
      : null;

  const threadedArgs = withDefaultThreads(originalArgs, threads);
  const primaryArgs = enableTypeAware ? withTypeAwareEnabled(threadedArgs) : threadedArgs;
  const primaryResult = await runBoundedCommand({
    args: primaryArgs,
    command,
    label: "oxlint --type-aware",
    memoryGuard,
    timeoutMs,
  });

  if (primaryResult.code === 0) {
    process.exit(0);
  }

  const canFallback =
    allowFallback || (primaryResult.memoryPressure != null && memoryPressureAllowsFallback);
  if (
    !enableTypeAware ||
    !canFallback ||
    (primaryResult.memoryPressure == null &&
      !primaryResult.timedOut &&
      primaryResult.error == null &&
      primaryResult.signal == null)
  ) {
    if (primaryResult.error != null) {
      console.error(`[openclaw] Failed to start oxlint: ${primaryResult.error.message}`);
    }
    if (primaryResult.memoryPressure != null) {
      console.error(
        "[openclaw] strict type-aware oxlint hit memory pressure locally; skipping hard failure.",
      );
      process.exit(0);
    }
    process.exit(toExitCode(primaryResult));
  }

  if (primaryResult.error != null) {
    console.error(`[openclaw] Failed to start type-aware oxlint: ${primaryResult.error.message}`);
  } else {
    console.error(
      "[openclaw] type-aware oxlint did not complete cleanly; retrying without --type-aware.",
    );
  }

  const fallbackArgs = withoutTypeAware(threadedArgs);
  const fallbackResult = await runOxlint(
    command,
    fallbackArgs,
    fallbackTimeoutMs,
    "oxlint fallback",
  );
  process.exit(toExitCode(fallbackResult));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[openclaw] run-oxlint-safe failed: ${message}`);
  process.exit(1);
}
