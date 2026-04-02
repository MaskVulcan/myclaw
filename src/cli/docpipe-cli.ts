import type { Command } from "commander";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import {
  extractPrimaryCommandPassthroughArgs,
  resolveBundledSkillScriptPath,
  runBundledSkillScript,
} from "./bundled-skill-cli.js";

const DOCPIPE_COMMAND = "docpipe";
const DOCPIPE_SCRIPT_PATH = "skills/document-processing-pipeline/scripts/docpipe";

export function resolveDocpipeScriptPath(moduleUrl: string = import.meta.url): string {
  return resolveBundledSkillScriptPath(DOCPIPE_SCRIPT_PATH, moduleUrl);
}

export function runDocpipeCliFromArgv(
  argv: readonly string[],
  deps: {
    spawn?: typeof import("node:child_process").spawnSync;
    runtime?: RuntimeEnv;
    env?: NodeJS.ProcessEnv;
    moduleUrl?: string;
  } = {},
): boolean {
  const forwardedArgs = extractPrimaryCommandPassthroughArgs(argv, DOCPIPE_COMMAND);
  if (!forwardedArgs) {
    return false;
  }

  const exitCode = runBundledSkillScript(resolveDocpipeScriptPath(deps.moduleUrl), forwardedArgs, {
    spawn: deps.spawn,
    runtime: deps.runtime,
    env: deps.env,
  });
  if (exitCode !== 0) {
    (deps.runtime ?? defaultRuntime).exit(exitCode);
  }

  return true;
}

export function registerDocpipeCli(program: Command) {
  program
    .command(DOCPIPE_COMMAND)
    .description("Run the bundled document-processing pipeline CLI")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  openclaw docpipe doctor",
        "  openclaw docpipe ingest ./input.pdf --run-dir ./work/run",
        "  openclaw docpipe assemble-markdown --run-dir ./work/run",
        "",
      ].join("\n"),
    )
    .action(() => {
      if (!runDocpipeCliFromArgv(process.argv)) {
        defaultRuntime.exit(2);
      }
    });
}
