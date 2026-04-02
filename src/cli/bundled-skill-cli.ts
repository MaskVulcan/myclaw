import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLAG_TERMINATOR, consumeRootOptionToken } from "../infra/cli-root-options.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export function extractPrimaryCommandPassthroughArgs(
  argv: readonly string[],
  commandName: string,
): string[] | null {
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === FLAG_TERMINATOR) {
      return null;
    }

    const consumedRootOption = consumeRootOptionToken(args, index);
    if (consumedRootOption > 0) {
      index += consumedRootOption - 1;
      continue;
    }

    if (arg.startsWith("-")) {
      return null;
    }

    if (arg !== commandName) {
      return null;
    }

    return args.slice(index + 1);
  }

  return null;
}

export function resolveBundledSkillScriptPath(
  scriptPath: string,
  moduleUrl: string = import.meta.url,
): string {
  let current = path.dirname(fileURLToPath(moduleUrl));
  while (true) {
    if (
      fs.existsSync(path.join(current, "openclaw.mjs")) &&
      fs.existsSync(path.join(current, "package.json"))
    ) {
      return path.join(current, scriptPath);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`openclaw: could not resolve package root for bundled CLI ${scriptPath}`);
    }
    current = parent;
  }
}

export function runBundledSkillScript(
  scriptPath: string,
  args: readonly string[],
  deps: {
    spawn?: typeof spawnSync;
    runtime?: RuntimeEnv;
    env?: NodeJS.ProcessEnv;
  } = {},
): number {
  const spawn = deps.spawn ?? spawnSync;
  const runtime = deps.runtime ?? defaultRuntime;
  const result = spawn("bash", [scriptPath, ...args], {
    stdio: "inherit",
    env: deps.env ?? process.env,
    windowsHide: true,
  });

  if (result.error) {
    runtime.error(`openclaw: failed to launch bundled CLI ${scriptPath}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}
