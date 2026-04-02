import type { Command } from "commander";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import {
  extractPrimaryCommandPassthroughArgs,
  resolveBundledSkillScriptPath,
  runBundledSkillScript,
} from "./bundled-skill-cli.js";

const CALENDAR_COMMAND = "calendar";
const CALENDAR_SCRIPT_PATH = "skills/smart-calendar/scripts/sc";

export function resolveCalendarScriptPath(moduleUrl: string = import.meta.url): string {
  return resolveBundledSkillScriptPath(CALENDAR_SCRIPT_PATH, moduleUrl);
}

export function runCalendarCliFromArgv(
  argv: readonly string[],
  deps: {
    spawn?: typeof import("node:child_process").spawnSync;
    runtime?: RuntimeEnv;
    env?: NodeJS.ProcessEnv;
    moduleUrl?: string;
  } = {},
): boolean {
  const forwardedArgs = extractPrimaryCommandPassthroughArgs(argv, CALENDAR_COMMAND);
  if (!forwardedArgs) {
    return false;
  }

  const exitCode = runBundledSkillScript(resolveCalendarScriptPath(deps.moduleUrl), forwardedArgs, {
    spawn: deps.spawn,
    runtime: deps.runtime,
    env: deps.env,
  });
  if (exitCode !== 0) {
    (deps.runtime ?? defaultRuntime).exit(exitCode);
  }

  return true;
}

export function registerCalendarCli(program: Command) {
  program
    .command(CALENDAR_COMMAND)
    .description("Run the bundled smart-calendar CLI for add/show/render flows")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  openclaw calendar add 明天下午3点和张总开会讨论Q1进度",
        "  openclaw calendar show --week",
        "  openclaw calendar render --view month",
        "",
      ].join("\n"),
    )
    .action(() => {
      if (!runCalendarCliFromArgv(process.argv)) {
        defaultRuntime.exit(2);
      }
    });
}
