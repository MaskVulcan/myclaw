import { z } from "zod";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import {
  stewardCurateCommand,
  stewardCycleCommand,
  stewardIncubateSkillsCommand,
  stewardIngestCommand,
  stewardMaintainCommand,
  stewardPromoteSkillsCommand,
} from "../commands/steward.js";
import { loadConfig } from "../config/config.js";
import type {
  CapabilityDescription,
  CapabilityDescriptor,
  CapabilityJsonSchema,
  CapabilitySummary,
} from "./types.js";

const CAPABILITY_ID_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CapabilityIdSchema = z.string().regex(CAPABILITY_ID_RE);

const BaseCapabilityResultSchema = z
  .object({
    runId: z.string().min(1),
    mode: z.enum(["dry-run", "apply"]),
    generatedAt: z.string().min(1),
  })
  .passthrough();

const SkillStatusEntrySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    source: z.string(),
    filePath: z.string(),
    skillKey: z.string(),
    eligible: z.boolean(),
    disabled: z.boolean(),
    blockedByAllowlist: z.boolean(),
    capabilities: z.array(z.string()).optional(),
    disclosureMode: z.enum(["capabilities-first", "full"]).optional(),
    capabilitySummary: z.string().optional(),
  })
  .passthrough();

const SkillStatusReportSchema = z
  .object({
    workspaceDir: z.string(),
    managedSkillsDir: z.string(),
    skills: z.array(SkillStatusEntrySchema),
  })
  .passthrough();

const SkillsListInputSchema = z
  .object({
    workspace: z.string().min(1),
    eligible: z.boolean().optional().default(false),
  })
  .strict();

const SkillsInfoInputSchema = z
  .object({
    workspace: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

const SkillsCheckOutputSchema = z
  .object({
    workspaceDir: z.string(),
    managedSkillsDir: z.string(),
    summary: z.object({
      total: z.number().int().nonnegative(),
      eligible: z.number().int().nonnegative(),
      disabled: z.number().int().nonnegative(),
      blockedByAllowlist: z.number().int().nonnegative(),
      needsSetup: z.number().int().nonnegative(),
    }),
    ready: z.array(SkillStatusEntrySchema),
    needsSetup: z.array(SkillStatusEntrySchema),
  })
  .passthrough();

const StewardWorkspaceInputSchema = z
  .object({
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

const StewardIngestInputSchema = z
  .object({
    store: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    allAgents: z.boolean().optional().default(false),
    active: z.number().int().positive().optional(),
    recent: z.number().int().positive().optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

const StewardCurateInputSchema = z
  .object({
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

const StewardMaintainInputSchema = StewardWorkspaceInputSchema;

const StewardIncubateSkillsInputSchema = z
  .object({
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

const StewardPromoteSkillsInputSchema = z
  .object({
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    minCandidates: z.number().int().positive().optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

const StewardCycleInputSchema = z
  .object({
    store: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    allAgents: z.boolean().optional().default(false),
    active: z.number().int().positive().optional(),
    recent: z.number().int().positive().optional(),
    curateLimit: z.number().int().positive().optional(),
    incubateLimit: z.number().int().positive().optional(),
    promoteLimit: z.number().int().positive().optional(),
    minCandidates: z.number().int().positive().optional(),
    apply: z.boolean().optional().default(false),
  })
  .strict();

class CapabilityExitError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function createCaptureRuntime() {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    runtime: {
      log: (...args: unknown[]) => {
        logs.push(args.map((value) => String(value)).join(" "));
      },
      error: (...args: unknown[]) => {
        errors.push(args.map((value) => String(value)).join(" "));
      },
      exit: (code: number) => {
        throw new CapabilityExitError(code, errors.at(-1) ?? `command exited with code ${code}`);
      },
      writeStdout: (value: string) => {
        logs.push(value);
      },
      writeJson: (value: unknown, space = 2) => {
        logs.push(JSON.stringify(value, null, space > 0 ? space : undefined));
      },
    },
    logs,
    errors,
  };
}

function parseCapturedJson<T>(logs: string[], schema: z.ZodType<T>, capabilityId: string): T {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const raw = logs[index]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return schema.parse(parsed);
    } catch {
      // keep scanning for the last valid JSON payload
    }
  }
  throw new Error(`${capabilityId}: command did not emit valid JSON output`);
}

function schemaToJson(schema: z.ZodTypeAny): CapabilityJsonSchema {
  return z.toJSONSchema(schema) as CapabilityJsonSchema;
}

function toCapabilitySummary(
  descriptor: CapabilityDescriptor<z.ZodTypeAny, z.ZodTypeAny>,
): CapabilitySummary {
  return {
    id: descriptor.id,
    title: descriptor.title,
    summary: descriptor.summary,
    category: descriptor.category,
    tags: [...descriptor.tags],
    disclosureMode: descriptor.disclosureMode,
    skillSummary: descriptor.skillSummary,
    sideEffects: [...descriptor.sideEffects],
    idempotent: descriptor.idempotent,
    dryRunSupported: descriptor.dryRunSupported,
    requiresConfirmation: descriptor.requiresConfirmation,
    underlyingCliCommand: [...descriptor.underlyingCliCommand],
  };
}

function buildSkillsCheckResult(workspace: string) {
  const report = buildWorkspaceSkillStatus(workspace, { config: loadConfig() });
  const ready = report.skills.filter((skill) => skill.eligible);
  const needsSetup = report.skills.filter((skill) => !skill.eligible);
  const disabled = report.skills.filter((skill) => skill.disabled).length;
  const blockedByAllowlist = report.skills.filter((skill) => skill.blockedByAllowlist).length;
  return {
    workspaceDir: report.workspaceDir,
    managedSkillsDir: report.managedSkillsDir,
    summary: {
      total: report.skills.length,
      eligible: ready.length,
      disabled,
      blockedByAllowlist,
      needsSetup: needsSetup.length,
    },
    ready,
    needsSetup,
  };
}

async function runStewardJsonCommand<T>(params: {
  capabilityId: string;
  schema: z.ZodType<T>;
  run: (runtime: ReturnType<typeof createCaptureRuntime>["runtime"]) => Promise<void>;
}): Promise<T> {
  const capture = createCaptureRuntime();
  await params.run(capture.runtime);
  return parseCapturedJson(capture.logs, params.schema, params.capabilityId);
}

const CAPABILITY_DESCRIPTORS = [
  {
    id: "skills.list",
    title: "List Workspace Skills",
    summary:
      "List skill headers visible to the current workspace without loading every skill body.",
    category: "skills",
    tags: ["skills", "workspace", "discovery"],
    disclosureMode: "capabilities-first",
    skillSummary:
      "Use to discover workspace skills and whether they already advertise capability ids.",
    sideEffects: ["filesystem-read", "config-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "skills", "list", "--json"],
    examples: [
      `openclaw capabilities run skills.list --input-json '{"workspace":"/root/.openclaw/agents/main"}'`,
    ],
    inputSchema: SkillsListInputSchema,
    outputSchema: SkillStatusReportSchema,
    execute: async (input) => {
      const report = buildWorkspaceSkillStatus(input.workspace, { config: loadConfig() });
      if (!input.eligible) {
        return SkillStatusReportSchema.parse(report);
      }
      return SkillStatusReportSchema.parse({
        ...report,
        skills: report.skills.filter((skill) => skill.eligible),
      });
    },
  },
  {
    id: "skills.info",
    title: "Inspect One Skill",
    summary: "Return one skill header and readiness details for targeted progressive disclosure.",
    category: "skills",
    tags: ["skills", "workspace", "inspection"],
    disclosureMode: "capabilities-first",
    skillSummary:
      "Use after selecting a skill name to inspect its declared capabilities and setup.",
    sideEffects: ["filesystem-read", "config-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "skills", "info", "--json", "<name>"],
    examples: [
      `openclaw capabilities run skills.info --input-json '{"workspace":"/root/.openclaw/agents/main","name":"release-checks"}'`,
    ],
    inputSchema: SkillsInfoInputSchema,
    outputSchema: SkillStatusEntrySchema,
    execute: async (input) => {
      const report = buildWorkspaceSkillStatus(input.workspace, { config: loadConfig() });
      const skill = report.skills.find(
        (entry) => entry.name === input.name || entry.skillKey === input.name,
      );
      if (!skill) {
        throw new Error(`skills.info: skill "${input.name}" not found in ${input.workspace}`);
      }
      return SkillStatusEntrySchema.parse(skill);
    },
  },
  {
    id: "skills.check",
    title: "Check Skill Readiness",
    summary: "Summarize which skills are ready versus blocked or missing setup.",
    category: "skills",
    tags: ["skills", "workspace", "readiness"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use when you need a quick readiness summary before selecting a skill.",
    sideEffects: ["filesystem-read", "config-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "skills", "check", "--json"],
    examples: [
      `openclaw capabilities run skills.check --input-json '{"workspace":"/root/.openclaw/agents/main"}'`,
    ],
    inputSchema: z.object({ workspace: z.string().min(1) }).strict(),
    outputSchema: SkillsCheckOutputSchema,
    execute: async (input) =>
      SkillsCheckOutputSchema.parse(buildSkillsCheckResult(input.workspace)),
  },
  {
    id: "steward.ingest",
    title: "Steward Ingest",
    summary: "Extract recent sessions into staged memory and skill candidates.",
    category: "steward",
    tags: ["memory", "skills", "automation", "steward"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use for the first automation pass that stages memory and skill candidates.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "ingest", "--json"],
    examples: [
      `openclaw capabilities run steward.ingest --input-json '{"workspace":"/root/.openclaw/agents/main","recent":5,"apply":false}'`,
    ],
    inputSchema: StewardIngestInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.ingest",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardIngestCommand(
            {
              store: input.store,
              workspace: input.workspace,
              agent: input.agent,
              allAgents: input.allAgents,
              active: input.active?.toString(),
              recent: input.recent?.toString(),
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
  {
    id: "steward.curate",
    title: "Steward Curate",
    summary: "Promote staged memory candidates into curated long-term topic notes.",
    category: "steward",
    tags: ["memory", "automation", "steward"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use after ingest when staged memory candidates are ready to curate.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "curate", "--json"],
    examples: [
      `openclaw capabilities run steward.curate --input-json '{"workspace":"/root/.openclaw/agents/main","limit":20,"apply":false}'`,
    ],
    inputSchema: StewardCurateInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.curate",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardCurateCommand(
            {
              workspace: input.workspace,
              agent: input.agent,
              limit: input.limit?.toString(),
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
  {
    id: "steward.maintain",
    title: "Steward Maintain",
    summary: "Maintain curated memory notes, evidence sizes, and candidate hygiene.",
    category: "steward",
    tags: ["memory", "automation", "steward", "maintenance"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use to keep curated notes compact, linked, and clean.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "maintain", "--json"],
    examples: [
      `openclaw capabilities run steward.maintain --input-json '{"workspace":"/root/.openclaw/agents/main","apply":false}'`,
    ],
    inputSchema: StewardMaintainInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.maintain",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardMaintainCommand(
            {
              workspace: input.workspace,
              agent: input.agent,
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
  {
    id: "steward.incubate-skills",
    title: "Steward Incubate Skills",
    summary: "Cluster repeated staged skill candidates into incubator notes.",
    category: "steward",
    tags: ["skills", "automation", "steward", "incubator"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use after ingest when repeated skill candidates should be clustered.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "incubate-skills", "--json"],
    examples: [
      `openclaw capabilities run steward.incubate-skills --input-json '{"workspace":"/root/.openclaw/agents/main","limit":50,"apply":false}'`,
    ],
    inputSchema: StewardIncubateSkillsInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.incubate-skills",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardIncubateSkillsCommand(
            {
              workspace: input.workspace,
              agent: input.agent,
              limit: input.limit?.toString(),
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
  {
    id: "steward.promote-skills",
    title: "Steward Promote Skills",
    summary: "Promote ready incubator notes into real workspace skills.",
    category: "steward",
    tags: ["skills", "automation", "steward", "promotion"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use when incubator notes are ready to become real skills.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "promote-skills", "--json"],
    examples: [
      `openclaw capabilities run steward.promote-skills --input-json '{"workspace":"/root/.openclaw/agents/main","minCandidates":2,"apply":false}'`,
    ],
    inputSchema: StewardPromoteSkillsInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.promote-skills",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardPromoteSkillsCommand(
            {
              workspace: input.workspace,
              agent: input.agent,
              limit: input.limit?.toString(),
              minCandidates: input.minCandidates?.toString(),
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
  {
    id: "steward.cycle",
    title: "Steward Cycle",
    summary: "Run ingest, curate, maintain, incubate-skills, and promote-skills as one pipeline.",
    category: "steward",
    tags: ["memory", "skills", "automation", "steward", "pipeline"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use for the full memory and skill stewardship pipeline.",
    sideEffects: ["filesystem-read", "filesystem-write", "config-read"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "steward", "cycle", "--json"],
    examples: [
      `openclaw capabilities run steward.cycle --input-json '{"workspace":"/root/.openclaw/agents/main","recent":5,"apply":false}'`,
    ],
    inputSchema: StewardCycleInputSchema,
    outputSchema: BaseCapabilityResultSchema,
    execute: async (input) =>
      runStewardJsonCommand({
        capabilityId: "steward.cycle",
        schema: BaseCapabilityResultSchema,
        run: async (runtime) => {
          await stewardCycleCommand(
            {
              store: input.store,
              workspace: input.workspace,
              agent: input.agent,
              allAgents: input.allAgents,
              active: input.active?.toString(),
              recent: input.recent?.toString(),
              curateLimit: input.curateLimit?.toString(),
              incubateLimit: input.incubateLimit?.toString(),
              promoteLimit: input.promoteLimit?.toString(),
              minCandidates: input.minCandidates?.toString(),
              apply: input.apply,
              json: true,
            },
            runtime,
          );
        },
      }),
  },
] as const satisfies ReadonlyArray<CapabilityDescriptor<z.ZodTypeAny, z.ZodTypeAny>>;

const CAPABILITY_MAP = new Map(
  CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

const OBSERVED_COMMAND_CAPABILITY_PREFIXES = [
  { prefix: "openclaw steward ingest", capabilityId: "steward.ingest" },
  { prefix: "openclaw steward curate", capabilityId: "steward.curate" },
  { prefix: "openclaw steward maintain", capabilityId: "steward.maintain" },
  { prefix: "openclaw steward incubate-skills", capabilityId: "steward.incubate-skills" },
  { prefix: "openclaw steward promote-skills", capabilityId: "steward.promote-skills" },
  { prefix: "openclaw steward cycle", capabilityId: "steward.cycle" },
  { prefix: "openclaw skills list", capabilityId: "skills.list" },
  { prefix: "openclaw skills info", capabilityId: "skills.info" },
  { prefix: "openclaw skills check", capabilityId: "skills.check" },
] as const;

export function listCapabilityDescriptors(): CapabilitySummary[] {
  return CAPABILITY_DESCRIPTORS.map((descriptor) => toCapabilitySummary(descriptor)).toSorted(
    (left, right) => left.id.localeCompare(right.id),
  );
}

export function getCapabilityDescriptor(id: string): CapabilityDescription | null {
  const parsedId = CapabilityIdSchema.safeParse(id.trim());
  if (!parsedId.success) {
    return null;
  }
  const descriptor = CAPABILITY_MAP.get(parsedId.data);
  if (!descriptor) {
    return null;
  }
  return {
    ...toCapabilitySummary(descriptor),
    inputSchema: schemaToJson(descriptor.inputSchema),
    outputSchema: schemaToJson(descriptor.outputSchema),
    examples: [...descriptor.examples],
  };
}

export async function runCapability(params: { id: string; input: unknown }): Promise<{
  capability: CapabilitySummary;
  input: unknown;
  output: unknown;
  runnerCommand: string[];
}> {
  const parsedId = CapabilityIdSchema.parse(params.id.trim());
  const descriptor = CAPABILITY_MAP.get(parsedId);
  if (!descriptor) {
    throw new Error(`Unknown capability: ${params.id}`);
  }
  const input = descriptor.inputSchema.parse(params.input);
  const output = descriptor.outputSchema.parse(await descriptor.execute(input));
  return {
    capability: toCapabilitySummary(descriptor),
    input,
    output,
    runnerCommand: [
      "openclaw",
      "capabilities",
      "run",
      descriptor.id,
      "--input-json",
      JSON.stringify(input),
    ],
  };
}

export function inferCapabilityIdsFromCommandLines(commands: string[]): string[] {
  const inferred = new Set<string>();
  for (const command of commands) {
    const normalized = command.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    for (const candidate of OBSERVED_COMMAND_CAPABILITY_PREFIXES) {
      if (normalized.startsWith(candidate.prefix)) {
        inferred.add(candidate.capabilityId);
      }
    }
  }
  return [...inferred].toSorted((left, right) => left.localeCompare(right));
}
