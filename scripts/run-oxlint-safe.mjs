#!/usr/bin/env node

import {
  defaultOxlintThreads,
  hasFlag,
  insertArgsBeforeDoubleDash,
  parseBooleanEnv,
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
  const enableTypeAware = parseBooleanEnv("OPENCLAW_LINT_TYPE_AWARE", true);
  const threads = parsePositiveIntEnv("OPENCLAW_OXLINT_THREADS", defaultOxlintThreads());

  const threadedArgs = withDefaultThreads(originalArgs, threads);
  const primaryArgs = enableTypeAware ? withTypeAwareEnabled(threadedArgs) : threadedArgs;
  const primaryResult = await runOxlint(command, primaryArgs, timeoutMs, "oxlint --type-aware");

  if (primaryResult.code === 0) {
    process.exit(0);
  }

  if (
    !enableTypeAware ||
    !allowFallback ||
    (!primaryResult.timedOut && primaryResult.error == null && primaryResult.signal == null)
  ) {
    if (primaryResult.error != null) {
      console.error(`[openclaw] Failed to start oxlint: ${primaryResult.error.message}`);
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
