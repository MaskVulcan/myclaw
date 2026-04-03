import path from "node:path";
import { z } from "zod";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { resolveCalendarScriptPath } from "../cli/calendar-cli.js";
import { resolveDocpipeScriptPath } from "../cli/docpipe-cli.js";
import {
  stewardCurateCommand,
  stewardCycleCommand,
  stewardIncubateSkillsCommand,
  stewardIngestCommand,
  stewardMaintainCommand,
  stewardPromoteSkillsCommand,
} from "../commands/steward.js";
import { loadConfig } from "../config/config.js";
import { execFileUtf8 } from "../daemon/exec-file.js";
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

const SmartCalendarPrioritySchema = z.enum(["high", "normal", "low"]);

const SmartCalendarEventSchema = z
  .object({
    id: z.string().min(1),
    date: z.string().min(1),
    time: z.string().min(1),
    title: z.string().min(1),
    category: z.string().min(1),
    participants: z.array(z.string()).default([]),
    location: z.string().default(""),
    notes: z.string().default(""),
    priority: SmartCalendarPrioritySchema.default("normal"),
    icon: z.string().optional(),
  })
  .passthrough();

const SmartCalendarTipSchema = z
  .object({
    name: z.string().min(1),
    personality: z.array(z.string()).default([]),
    collaboration_tips: z.array(z.string()).default([]),
  })
  .passthrough();

const SmartCalendarAddInputSchema = z
  .object({
    calendarHome: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    time: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    withPeople: z.array(z.string().min(1)).optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    priority: SmartCalendarPrioritySchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.text?.trim() || value.title?.trim()), {
    message: "Provide text or title for smart-calendar.add",
  });

const SmartCalendarShowInputSchema = z
  .object({
    calendarHome: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    week: z.boolean().optional().default(false),
    month: z.boolean().optional().default(false),
    range: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    withPeople: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
  })
  .strict();

const SmartCalendarRenderInputSchema = z
  .object({
    calendarHome: z.string().min(1).optional(),
    view: z.enum(["month", "week", "day"]).optional(),
    heatmap: z.string().min(1).optional(),
    week: z.boolean().optional().default(false),
    month: z.boolean().optional().default(false),
    year: z.boolean().optional().default(false),
    range: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    withPeople: z.string().min(1).optional(),
  })
  .strict();

const SmartCalendarQuerySchema = z
  .object({
    start_date: z.string().min(1),
    end_date: z.string().min(1),
  })
  .passthrough();

const SmartCalendarAddOutputSchema = z
  .object({
    ok: z.literal(true),
    calendar_home: z.string().min(1),
    event: SmartCalendarEventSchema,
    conflicts: z.array(SmartCalendarEventSchema),
  })
  .passthrough();

const SmartCalendarShowOutputSchema = z
  .object({
    ok: z.literal(true),
    calendar_home: z.string().min(1),
    query: SmartCalendarQuerySchema,
    events: z.array(SmartCalendarEventSchema),
    tips: z.array(SmartCalendarTipSchema),
  })
  .passthrough();

const SmartCalendarRenderOutputSchema = z
  .object({
    ok: z.literal(true),
    calendar_home: z.string().min(1),
    mode: z.enum(["calendar", "heatmap"]),
    view: z.enum(["month", "week", "day"]).optional(),
    output_path: z.string().min(1).nullable().optional(),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    heatmap: z.string().optional(),
    with_people: z.string().optional(),
    events: z.array(SmartCalendarEventSchema).default([]),
  })
  .passthrough();

const DocpipeRouteTaskSchema = z.enum([
  "translate",
  "summarize",
  "simplify",
  "rebuild",
  "extract-text",
  "extract-fields",
  "edit-docx",
  "compare-docx",
  "overlay-pdf",
  "side-by-side-pdf",
  "pdf-direct",
  "merge-pdf",
  "split-pdf",
  "rotate-pdf",
  "watermark-pdf",
  "form-fill-pdf",
  "extract-pdf",
]);

const DocpipeRouteInputSchema = z
  .object({
    source: z.string().min(1),
    task: DocpipeRouteTaskSchema,
    runDir: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    outputFormat: z.string().min(1).optional(),
    sourceLang: z.string().min(1).optional(),
    targetLang: z.string().min(1).optional(),
    backend: z.string().min(1).optional(),
    requiresRedline: z.boolean().optional().default(false),
    requiresReview: z.boolean().optional().default(false),
    requiresOcr: z.boolean().optional().default(false),
    layoutPreserving: z.boolean().optional().default(false),
  })
  .strict();

const DocpipeRouteOutputSchema = z
  .object({
    lane: z.string().min(1),
    available: z.boolean(),
    reason: z.string().min(1),
    commands: z.array(z.array(z.string())).default([]),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();

const DocpipeIngestInputSchema = z
  .object({
    source: z.string().min(1),
    runDir: z.string().min(1),
    backend: z.string().min(1).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

const DocpipeRunDirOutputSchema = z
  .object({
    run_dir: z.string().min(1),
  })
  .passthrough();

const DocpipeParagraphRecordSchema = z
  .object({
    paragraph_id: z.string().min(1),
    index: z.number().int().positive(),
    style: z.string().nullable().optional(),
    text: z.string(),
  })
  .passthrough();

const DocpipeDocxInspectInputSchema = z
  .object({
    source: z.string().min(1),
  })
  .strict();

const DocpipeDocxGrepInputSchema = z
  .object({
    source: z.string().min(1),
    patterns: z.array(z.string().min(1)).min(1),
  })
  .strict();

const DocpipeDocxGrepMatchSchema = z
  .object({
    paragraph_id: z.string().min(1),
    index: z.number().int().positive(),
    style: z.string().nullable().optional(),
    pattern: z.string().min(1),
    text: z.string(),
  })
  .passthrough();

const DocpipeOcrInputSchema = z
  .object({
    source: z.string().min(1),
    output: z.string().min(1).optional(),
    lang: z.string().min(1).optional(),
    forceOcr: z.boolean().optional().default(false),
    pages: z.string().min(1).optional(),
    format: z.enum(["markdown", "jsonl"]).optional().default("markdown"),
  })
  .strict();

const DocpipeOutputPathSchema = z
  .object({
    output_path: z.string().min(1),
  })
  .passthrough();

const SKILL_CLI_TIMEOUT_MS = 5 * 60 * 1000;
const SKILL_CLI_MAX_BUFFER = 16 * 1024 * 1024;

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

function parseJsonFromCommandOutput<T>(
  output: string,
  schema: z.ZodType<T>,
  capabilityId: string,
): T {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error(`${capabilityId}: command did not emit JSON output`);
  }
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") {
      continue;
    }
    try {
      return schema.parse(JSON.parse(trimmed.slice(index)) as unknown);
    } catch {
      // keep scanning for the trailing JSON payload
    }
  }
  throw new Error(`${capabilityId}: command did not emit valid JSON output`);
}

async function runBundledSkillJsonCommand<T>(params: {
  capabilityId: string;
  scriptPath: string;
  args: string[];
  schema: z.ZodType<T>;
  env?: NodeJS.ProcessEnv;
}): Promise<T> {
  const result = await execFileUtf8("bash", [params.scriptPath, ...params.args], {
    env: {
      ...process.env,
      ...params.env,
    },
    timeout: SKILL_CLI_TIMEOUT_MS,
    maxBuffer: SKILL_CLI_MAX_BUFFER,
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`${params.capabilityId}: command failed (${result.code}): ${detail}`);
  }
  return parseJsonFromCommandOutput(result.stdout, params.schema, params.capabilityId);
}

function appendStringFlag(argv: string[], flag: string, value?: string) {
  if (value?.trim()) {
    argv.push(flag, value.trim());
  }
}

function appendBooleanFlag(argv: string[], flag: string, value?: boolean) {
  if (value) {
    argv.push(flag);
  }
}

function normalizeObservedCommandLine(command: string): string {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  const normalizeToken = (value: string) => {
    const unquoted = value.replace(/^['"]+|['"]+$/g, "");
    return path.posix.basename(path.win32.basename(unquoted));
  };
  const first = normalizeToken(tokens[0] ?? "");
  if (["bash", "sh", "zsh"].includes(first) && tokens.length > 1) {
    const second = normalizeToken(tokens[1] ?? "");
    return [second, ...tokens.slice(2)].join(" ");
  }
  return [first, ...tokens.slice(1)].join(" ");
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
    id: "smart-calendar.add",
    title: "Add Calendar Event",
    summary: "Create one grounded event in the bundled smart-calendar store.",
    category: "calendar",
    tags: ["calendar", "schedule", "skill", "write"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use to add a local schedule item through the stable smart-calendar wrapper.",
    sideEffects: ["filesystem-read", "filesystem-write"],
    idempotent: false,
    dryRunSupported: false,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "calendar", "add", "--json"],
    examples: [
      `openclaw capabilities run smart-calendar.add --input-json '{"calendarHome":"/tmp/calendar","text":"明天下午3点和张总开会","category":"会议"}'`,
    ],
    inputSchema: SmartCalendarAddInputSchema,
    outputSchema: SmartCalendarAddOutputSchema,
    execute: async (input) => {
      const args = ["add", "--json"];
      appendStringFlag(args, "--date", input.date);
      appendStringFlag(args, "--time", input.time);
      appendStringFlag(args, "--title", input.title);
      appendStringFlag(args, "--category", input.category);
      if ((input.withPeople?.length ?? 0) > 0) {
        args.push("--with", input.withPeople!.join(","));
      }
      appendStringFlag(args, "--location", input.location);
      appendStringFlag(args, "--notes", input.notes);
      appendStringFlag(args, "--priority", input.priority);
      if (input.text?.trim()) {
        args.push(input.text.trim());
      }
      return await runBundledSkillJsonCommand({
        capabilityId: "smart-calendar.add",
        scriptPath: resolveCalendarScriptPath(),
        args,
        env: input.calendarHome ? { SMART_CALENDAR_HOME: input.calendarHome } : undefined,
        schema: SmartCalendarAddOutputSchema,
      });
    },
  },
  {
    id: "smart-calendar.show",
    title: "Show Calendar Events",
    summary: "Query bundled smart-calendar events and collaboration tips as structured JSON.",
    category: "calendar",
    tags: ["calendar", "schedule", "skill", "read"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use to inspect upcoming schedules before replying or rendering.",
    sideEffects: ["filesystem-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "calendar", "show", "--json"],
    examples: [
      `openclaw capabilities run smart-calendar.show --input-json '{"calendarHome":"/tmp/calendar","week":true}'`,
    ],
    inputSchema: SmartCalendarShowInputSchema,
    outputSchema: SmartCalendarShowOutputSchema,
    execute: async (input) => {
      const args = ["show", "--json"];
      appendStringFlag(args, "--date", input.date);
      appendBooleanFlag(args, "--week", input.week);
      appendBooleanFlag(args, "--month", input.month);
      appendStringFlag(args, "--range", input.range);
      appendStringFlag(args, "--category", input.category);
      appendStringFlag(args, "--with", input.withPeople);
      appendStringFlag(args, "--search", input.search);
      return await runBundledSkillJsonCommand({
        capabilityId: "smart-calendar.show",
        scriptPath: resolveCalendarScriptPath(),
        args,
        env: input.calendarHome ? { SMART_CALENDAR_HOME: input.calendarHome } : undefined,
        schema: SmartCalendarShowOutputSchema,
      });
    },
  },
  {
    id: "smart-calendar.render",
    title: "Render Calendar View",
    summary: "Render a bundled smart-calendar calendar or heatmap view to an image file.",
    category: "calendar",
    tags: ["calendar", "schedule", "skill", "render"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use when a schedule request should also return a rendered calendar artifact.",
    sideEffects: ["filesystem-read", "filesystem-write"],
    idempotent: false,
    dryRunSupported: false,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "calendar", "render", "--json"],
    examples: [
      `openclaw capabilities run smart-calendar.render --input-json '{"calendarHome":"/tmp/calendar","view":"week"}'`,
    ],
    inputSchema: SmartCalendarRenderInputSchema,
    outputSchema: SmartCalendarRenderOutputSchema,
    execute: async (input) => {
      const args = ["render", "--json"];
      appendStringFlag(args, "--view", input.view);
      appendStringFlag(args, "--heatmap", input.heatmap);
      appendBooleanFlag(args, "--week", input.week);
      appendBooleanFlag(args, "--month", input.month);
      appendBooleanFlag(args, "--year", input.year);
      appendStringFlag(args, "--range", input.range);
      appendStringFlag(args, "--date", input.date);
      appendStringFlag(args, "--with", input.withPeople);
      return await runBundledSkillJsonCommand({
        capabilityId: "smart-calendar.render",
        scriptPath: resolveCalendarScriptPath(),
        args,
        env: input.calendarHome ? { SMART_CALENDAR_HOME: input.calendarHome } : undefined,
        schema: SmartCalendarRenderOutputSchema,
      });
    },
  },
  {
    id: "document-processing.route",
    title: "Route Document Task",
    summary: "Choose the stable document-processing lane and suggested commands for one file task.",
    category: "documents",
    tags: ["documents", "skill", "routing", "planning"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use before running a larger document workflow when the right lane is unclear.",
    sideEffects: ["filesystem-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "docpipe", "route"],
    examples: [
      `openclaw capabilities run document-processing.route --input-json '{"source":"./paper.pdf","task":"translate","layoutPreserving":true}'`,
    ],
    inputSchema: DocpipeRouteInputSchema,
    outputSchema: DocpipeRouteOutputSchema,
    execute: async (input) => {
      const args = ["route", input.source, "--task", input.task];
      appendStringFlag(args, "--run-dir", input.runDir);
      appendStringFlag(args, "--mime-type", input.mimeType);
      appendStringFlag(args, "--output-format", input.outputFormat);
      appendStringFlag(args, "--source-lang", input.sourceLang);
      appendStringFlag(args, "--target-lang", input.targetLang);
      appendStringFlag(args, "--backend", input.backend);
      appendBooleanFlag(args, "--requires-redline", input.requiresRedline);
      appendBooleanFlag(args, "--requires-review", input.requiresReview);
      appendBooleanFlag(args, "--requires-ocr", input.requiresOcr);
      appendBooleanFlag(args, "--layout-preserving", input.layoutPreserving);
      return await runBundledSkillJsonCommand({
        capabilityId: "document-processing.route",
        scriptPath: resolveDocpipeScriptPath(),
        args,
        schema: DocpipeRouteOutputSchema,
      });
    },
  },
  {
    id: "document-processing.ingest",
    title: "Ingest Document",
    summary: "Ingest one source document into a structured docpipe run directory.",
    category: "documents",
    tags: ["documents", "skill", "pipeline", "ingest"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use for deterministic document ingest before transform or rebuild stages.",
    sideEffects: ["filesystem-read", "filesystem-write"],
    idempotent: false,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "docpipe", "ingest"],
    examples: [
      `openclaw capabilities run document-processing.ingest --input-json '{"source":"./paper.pdf","runDir":"./work/paper","dryRun":false}'`,
    ],
    inputSchema: DocpipeIngestInputSchema,
    outputSchema: DocpipeRunDirOutputSchema,
    execute: async (input) => {
      const args = ["ingest", input.source, "--run-dir", input.runDir];
      appendStringFlag(args, "--backend", input.backend);
      appendBooleanFlag(args, "--dry-run", input.dryRun);
      return await runBundledSkillJsonCommand({
        capabilityId: "document-processing.ingest",
        scriptPath: resolveDocpipeScriptPath(),
        args,
        schema: DocpipeRunDirOutputSchema,
      });
    },
  },
  {
    id: "document-processing.docx-inspect",
    title: "Inspect DOCX Paragraphs",
    summary: "Inspect DOCX paragraph records for precise local editing or review.",
    category: "documents",
    tags: ["documents", "skill", "docx", "inspection"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use for paragraph-level DOCX inspection before grep or apply-plan.",
    sideEffects: ["filesystem-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "docpipe", "docx-inspect"],
    examples: [
      `openclaw capabilities run document-processing.docx-inspect --input-json '{"source":"./contract.docx"}'`,
    ],
    inputSchema: DocpipeDocxInspectInputSchema,
    outputSchema: z.array(DocpipeParagraphRecordSchema),
    execute: async (input) =>
      await runBundledSkillJsonCommand({
        capabilityId: "document-processing.docx-inspect",
        scriptPath: resolveDocpipeScriptPath(),
        args: ["docx-inspect", input.source],
        schema: z.array(DocpipeParagraphRecordSchema),
      }),
  },
  {
    id: "document-processing.docx-grep",
    title: "Search DOCX Paragraphs",
    summary: "Search a DOCX for matching paragraphs without free-form shell grep.",
    category: "documents",
    tags: ["documents", "skill", "docx", "search"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use for deterministic paragraph search before planning local DOCX edits.",
    sideEffects: ["filesystem-read"],
    idempotent: true,
    dryRunSupported: true,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "docpipe", "docx-grep"],
    examples: [
      `openclaw capabilities run document-processing.docx-grep --input-json '{"source":"./contract.docx","patterns":["termination"]}'`,
    ],
    inputSchema: DocpipeDocxGrepInputSchema,
    outputSchema: z.array(DocpipeDocxGrepMatchSchema),
    execute: async (input) => {
      const args = ["docx-grep", input.source];
      for (const pattern of input.patterns) {
        args.push("--pattern", pattern);
      }
      return await runBundledSkillJsonCommand({
        capabilityId: "document-processing.docx-grep",
        scriptPath: resolveDocpipeScriptPath(),
        args,
        schema: z.array(DocpipeDocxGrepMatchSchema),
      });
    },
  },
  {
    id: "document-processing.ocr-pdf",
    title: "OCR Local PDF Or Image",
    summary: "Run local OCR for one PDF or image through the bundled docpipe wrapper.",
    category: "documents",
    tags: ["documents", "skill", "ocr", "extraction"],
    disclosureMode: "capabilities-first",
    skillSummary: "Use when document text must be extracted locally before downstream processing.",
    sideEffects: ["filesystem-read", "filesystem-write"],
    idempotent: false,
    dryRunSupported: false,
    requiresConfirmation: false,
    underlyingCliCommand: ["openclaw", "docpipe", "ocr-pdf"],
    examples: [
      `openclaw capabilities run document-processing.ocr-pdf --input-json '{"source":"./scan.pdf","format":"markdown"}'`,
    ],
    inputSchema: DocpipeOcrInputSchema,
    outputSchema: DocpipeOutputPathSchema,
    execute: async (input) => {
      const args = ["ocr-pdf", input.source];
      appendStringFlag(args, "--output", input.output);
      appendStringFlag(args, "--lang", input.lang);
      appendBooleanFlag(args, "--force-ocr", input.forceOcr);
      appendStringFlag(args, "--pages", input.pages);
      appendStringFlag(args, "--format", input.format);
      return await runBundledSkillJsonCommand({
        capabilityId: "document-processing.ocr-pdf",
        scriptPath: resolveDocpipeScriptPath(),
        args,
        schema: DocpipeOutputPathSchema,
      });
    },
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
  { prefix: "openclaw calendar add", capabilityId: "smart-calendar.add" },
  { prefix: "openclaw calendar show", capabilityId: "smart-calendar.show" },
  { prefix: "openclaw calendar render", capabilityId: "smart-calendar.render" },
  { prefix: "sc add", capabilityId: "smart-calendar.add" },
  { prefix: "sc show", capabilityId: "smart-calendar.show" },
  { prefix: "sc render", capabilityId: "smart-calendar.render" },
  { prefix: "openclaw docpipe route", capabilityId: "document-processing.route" },
  { prefix: "openclaw docpipe ingest", capabilityId: "document-processing.ingest" },
  { prefix: "openclaw docpipe docx-inspect", capabilityId: "document-processing.docx-inspect" },
  { prefix: "openclaw docpipe docx-grep", capabilityId: "document-processing.docx-grep" },
  { prefix: "openclaw docpipe ocr-pdf", capabilityId: "document-processing.ocr-pdf" },
  { prefix: "docpipe route", capabilityId: "document-processing.route" },
  { prefix: "docpipe ingest", capabilityId: "document-processing.ingest" },
  { prefix: "docpipe docx-inspect", capabilityId: "document-processing.docx-inspect" },
  { prefix: "docpipe docx-grep", capabilityId: "document-processing.docx-grep" },
  { prefix: "docpipe ocr-pdf", capabilityId: "document-processing.ocr-pdf" },
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
    const normalized = normalizeObservedCommandLine(command);
    if (!normalized) {
      continue;
    }
    const capabilityRunnerMatch = normalized.match(
      /^openclaw capabilities (?:run|describe) ([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)\b/,
    );
    if (capabilityRunnerMatch?.[1]) {
      inferred.add(capabilityRunnerMatch[1]);
    }
    for (const candidate of OBSERVED_COMMAND_CAPABILITY_PREFIXES) {
      if (normalized.startsWith(candidate.prefix)) {
        inferred.add(candidate.capabilityId);
      }
    }
  }
  return [...inferred].toSorted((left, right) => left.localeCompare(right));
}
