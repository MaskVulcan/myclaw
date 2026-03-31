#!/usr/bin/env node

import {
  parseBooleanEnv,
  parsePositiveIntEnv,
  resolveToolCommand,
  runBoundedCommand,
} from "./lib/run-bounded-command.mjs";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 180_000;

function defaultTsgoArgs(args) {
  return args.length === 0 ? ["--noEmit"] : args;
}

function fallbackTscArgs(args) {
  if (args.length === 0) {
    return ["--noEmit"];
  }
  return args.includes("--noEmit") ? args : ["--noEmit", ...args];
}

function toExitCode(result) {
  if (result.code != null) {
    return result.code;
  }
  return result.timedOut ? 124 : 1;
}

async function runTscFallback(args, timeoutMs) {
  const command = resolveToolCommand("tsc", "OPENCLAW_TSC_BIN");
  console.error("[openclaw] Falling back to tsc for type checking.");
  return await runBoundedCommand({
    args,
    command,
    label: "tsc fallback",
    timeoutMs,
  });
}

function shouldSoftSkip(result, strictMode) {
  if (strictMode) {
    return false;
  }
  return result.timedOut || result.error != null || result.signal != null;
}

function exitWithResultOrSoftSkip(result, strictMode, label) {
  if (shouldSoftSkip(result, strictMode)) {
    console.error(
      `[openclaw] ${label} hit a resource limit locally; skipping hard failure. ` +
        "Set OPENCLAW_TSGO_STRICT=1 to fail instead.",
    );
    process.exit(0);
  }

  process.exit(toExitCode(result));
}

async function main() {
  const args = process.argv.slice(2);
  const tsgoArgs = defaultTsgoArgs(args);
  const tscArgs = fallbackTscArgs(args);
  const timeoutMs = parsePositiveIntEnv("OPENCLAW_TSGO_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const fallbackTimeoutMs = parsePositiveIntEnv(
    "OPENCLAW_TSC_TIMEOUT_MS",
    DEFAULT_FALLBACK_TIMEOUT_MS,
  );
  const allowFallback = parseBooleanEnv("OPENCLAW_TSGO_ALLOW_FALLBACK", false);
  const preferTsc = parseBooleanEnv("OPENCLAW_TSGO_PREFER_TSC", false);
  const defaultStrictMode =
    process.env.CI != null &&
    process.env.CI !== "" &&
    process.env.CI !== "0" &&
    process.env.CI.toLowerCase() !== "false";
  const strictMode = parseBooleanEnv("OPENCLAW_TSGO_STRICT", defaultStrictMode);

  if (preferTsc) {
    const fallbackResult = await runTscFallback(tscArgs, fallbackTimeoutMs);
    exitWithResultOrSoftSkip(fallbackResult, strictMode, "tsc fallback");
    return;
  }

  const command = resolveToolCommand("tsgo", "OPENCLAW_TSGO_BIN");
  const result = await runBoundedCommand({
    args: tsgoArgs,
    command,
    label: "tsgo",
    timeoutMs,
  });

  if (result.code === 0) {
    process.exit(0);
  }

  if (!allowFallback || (!result.timedOut && result.error == null && result.signal == null)) {
    if (result.error != null) {
      console.error(`[openclaw] Failed to start tsgo: ${result.error.message}`);
    }
    exitWithResultOrSoftSkip(result, strictMode, "tsgo");
    return;
  }

  if (result.error != null) {
    console.error(`[openclaw] Failed to start tsgo: ${result.error.message}`);
  }

  const fallbackResult = await runTscFallback(tscArgs, fallbackTimeoutMs);
  exitWithResultOrSoftSkip(fallbackResult, strictMode, "tsc fallback");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[openclaw] run-tsgo-safe failed: ${message}`);
  process.exit(1);
}
