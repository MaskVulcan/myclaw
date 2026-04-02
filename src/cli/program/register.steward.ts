import type { Command } from "commander";
import {
  stewardCurateCommand,
  stewardCycleCommand,
  stewardIncubateSkillsCommand,
  stewardIngestCommand,
  stewardMaintainCommand,
  stewardPromoteSkillsCommand,
} from "../../commands/steward.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerStewardCommand(program: Command) {
  const steward = program
    .command("steward")
    .description("Automate memory and skill stewardship from recent sessions")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw steward ingest", "Dry-run candidate extraction from recent sessions."],
          [
            "openclaw steward ingest --active 180 --recent 3 --apply",
            "Write staged memory/skill candidates for the last 3 active sessions.",
          ],
          [
            "openclaw steward ingest --agent work --json",
            "Emit machine-readable candidate planning for one agent.",
          ],
          [
            "openclaw steward ingest --workspace ~/vaults/main --apply",
            "Stage candidates into an explicit Obsidian/OpenClaw workspace.",
          ],
          [
            "openclaw steward curate --workspace ~/vaults/main --apply",
            "Promote staged memory inbox candidates into curated topic notes.",
          ],
          [
            "openclaw steward maintain --workspace ~/vaults/main --apply",
            "Split oversized evidence, rebuild MEMORY.md links, and clean malformed candidates.",
          ],
          [
            "openclaw steward incubate-skills --workspace ~/vaults/main --apply",
            "Cluster repeated skill candidates into incubator notes.",
          ],
          [
            "openclaw steward promote-skills --workspace ~/vaults/main --apply",
            "Promote ready incubator notes into real `skills/<slug>/SKILL.md` files.",
          ],
          [
            "openclaw steward cycle --workspace ~/vaults/main --apply",
            "Run ingest, curate, maintain, incubate-skills, and promote-skills as one pipeline.",
          ],
        ])}`,
    );

  steward
    .command("ingest")
    .description("Extract recent sessions into staged memory and skill candidates")
    .option("--store <path>", "Path to session store (default: resolved from config)")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option("--agent <id>", "Agent id to inspect (default: configured default agent)")
    .option("--all-agents", "Aggregate sessions across all configured agents", false)
    .option("--active <minutes>", "Only inspect sessions updated within the past N minutes")
    .option("--recent <count>", "How many recent sessions to inspect", "5")
    .option("--apply", "Write candidates and steward ledger", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardIngestCommand(
          {
            store: opts.store as string | undefined,
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            allAgents: Boolean(opts.allAgents),
            active: opts.active as string | undefined,
            recent: opts.recent as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  steward
    .command("curate")
    .description("Promote steward inbox candidates into curated long-term topic notes")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option(
      "--agent <id>",
      "Agent id whose workspace should be curated when --workspace is omitted",
    )
    .option("--limit <count>", "How many staged candidates to inspect", "20")
    .option("--apply", "Write curated notes, MEMORY.md links, and steward ledger", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardCurateCommand(
          {
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            limit: opts.limit as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  steward
    .command("maintain")
    .description("Maintain curated memory notes, evidence size, and steward candidate hygiene")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option(
      "--agent <id>",
      "Agent id whose workspace should be maintained when --workspace is omitted",
    )
    .option("--apply", "Write maintained topic notes, cleanup deletions, and steward ledger", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardMaintainCommand(
          {
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  steward
    .command("incubate-skills")
    .description("Cluster repeated staged skill candidates into incubator notes")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option(
      "--agent <id>",
      "Agent id whose workspace should be incubated when --workspace is omitted",
    )
    .option("--limit <count>", "How many staged skill candidates to inspect", "50")
    .option("--apply", "Write incubator notes and steward ledger", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardIncubateSkillsCommand(
          {
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            limit: opts.limit as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  steward
    .command("promote-skills")
    .description("Promote ready incubator notes into workspace skills")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option(
      "--agent <id>",
      "Agent id whose workspace should be promoted when --workspace is omitted",
    )
    .option("--limit <count>", "How many incubator notes to inspect", "50")
    .option("--min-candidates <count>", "Minimum clustered candidates required for promotion", "2")
    .option("--apply", "Write promoted skills and steward ledger", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardPromoteSkillsCommand(
          {
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            limit: opts.limit as string | undefined,
            minCandidates: opts.minCandidates as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  steward
    .command("cycle")
    .description("Run the full steward automation pipeline in sequence")
    .option("--store <path>", "Path to session store (default: resolved from config)")
    .option("--workspace <dir>", "Explicit workspace directory for steward outputs")
    .option("--agent <id>", "Agent id to inspect (default: configured default agent)")
    .option("--all-agents", "Aggregate sessions across all configured agents", false)
    .option("--active <minutes>", "Only inspect sessions updated within the past N minutes")
    .option("--recent <count>", "How many recent sessions to inspect", "5")
    .option("--curate-limit <count>", "How many staged memory candidates to inspect", "20")
    .option("--incubate-limit <count>", "How many staged skill candidates to inspect", "50")
    .option("--promote-limit <count>", "How many incubator notes to inspect", "50")
    .option("--min-candidates <count>", "Minimum clustered candidates required for promotion", "2")
    .option("--apply", "Write the full steward pipeline to disk", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stewardCycleCommand(
          {
            store: opts.store as string | undefined,
            workspace: opts.workspace as string | undefined,
            agent: opts.agent as string | undefined,
            allAgents: Boolean(opts.allAgents),
            active: opts.active as string | undefined,
            recent: opts.recent as string | undefined,
            curateLimit: opts.curateLimit as string | undefined,
            incubateLimit: opts.incubateLimit as string | undefined,
            promoteLimit: opts.promoteLimit as string | undefined,
            minCandidates: opts.minCandidates as string | undefined,
            apply: Boolean(opts.apply),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });
}
