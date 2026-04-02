import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, type SessionEntry } from "../config/sessions.js";
import {
  classifySessionKey,
  readSessionMessages,
  readSessionPreviewItemsFromTranscript,
  readSessionTitleFieldsFromTranscript,
  type SessionPreviewItem,
} from "../gateway/session-utils.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { hasInterSessionUserProvenance } from "../sessions/input-provenance.js";
import { stripEnvelope } from "../shared/chat-envelope.js";
import { normalizeHyphenSlug } from "../shared/string-normalization.js";
import { resolveUserPath } from "../utils.js";
import { stripInlineDirectiveTagsForDisplay } from "../utils/directive-tags.js";
import { extractToolCallNames } from "../utils/transcript-tools.js";
import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";

type StewardIngestOptions = {
  json?: boolean;
  store?: string;
  workspace?: string;
  active?: string;
  agent?: string;
  allAgents?: boolean;
  recent?: string;
  apply?: boolean;
};

type StewardCurateOptions = {
  json?: boolean;
  workspace?: string;
  agent?: string;
  limit?: string;
  apply?: boolean;
};

type StewardMaintainOptions = {
  json?: boolean;
  workspace?: string;
  agent?: string;
  apply?: boolean;
};

type StewardIncubateSkillsOptions = {
  json?: boolean;
  workspace?: string;
  agent?: string;
  limit?: string;
  apply?: boolean;
};

type StewardPromoteSkillsOptions = {
  json?: boolean;
  workspace?: string;
  agent?: string;
  limit?: string;
  minCandidates?: string;
  apply?: boolean;
};

type StewardCycleOptions = {
  json?: boolean;
  store?: string;
  workspace?: string;
  agent?: string;
  allAgents?: boolean;
  active?: string;
  recent?: string;
  curateLimit?: string;
  incubateLimit?: string;
  promoteLimit?: string;
  minCandidates?: string;
  apply?: boolean;
};

type StewardSessionKind = "direct" | "group" | "global" | "unknown";

type CandidateKind = "memory" | "skill";

type StewardCandidatePlan = {
  kind: CandidateKind;
  path: string;
  title: string;
  bytes: number;
};

type StewardSessionPlan = {
  key: string;
  agentId: string;
  workspaceDir: string;
  storePath: string;
  kind: StewardSessionKind;
  sessionId: string;
  updatedAt: number | null;
  decision: "keep" | "discard";
  reasons: string[];
  previewItems: SessionPreviewItem[];
  firstUserMessage: string | null;
  lastMessagePreview: string | null;
  memoryCandidate: StewardCandidatePlan | null;
  skillCandidate: StewardCandidatePlan | null;
};

type WorkspaceLedgerSummary = {
  workspaceDir: string;
  agentIds: string[];
  sessionCount: number;
  keptCount: number;
  discardedCount: number;
  memoryCandidates: string[];
  skillCandidates: string[];
};

type StewardIngestResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  scannedSessions: number;
  selectedSessions: number;
  keptSessions: number;
  discardedSessions: number;
  memoryCandidates: number;
  skillCandidates: number;
  ledgerPaths: string[];
  sessions: StewardSessionPlan[];
};

type StewardIngestRow = {
  key: string;
  agentId: string;
  workspaceDir: string;
  storePath?: string;
  entry: SessionEntry;
};

type StewardPreparedSession = {
  session: StewardSessionPlan;
  memoryContent: string | null;
  skillContent: string | null;
};

type StewardCurateCandidatePlan = {
  candidatePath: string;
  targetPath: string;
  title: string;
  action: "create" | "update" | "skip";
  factsAdded: number;
  evidenceAdded: number;
  sourceCandidatesAdded: number;
};

type StewardCurateResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  workspaceDir: string;
  scannedCandidates: number;
  curatedCandidates: number;
  createdNotes: number;
  updatedNotes: number;
  memoryIndexUpdated: boolean;
  ledgerPaths: string[];
  candidates: StewardCurateCandidatePlan[];
};

type StewardMaintainTopicPlan = {
  targetPath: string;
  action: "split" | "skip";
  evidenceMoved: number;
  chunkPath?: string;
};

type StewardMaintainResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  workspaceDir: string;
  scannedTopics: number;
  splitTopics: number;
  evidenceChunksWritten: number;
  deletedPaths: string[];
  memoryIndexUpdated: boolean;
  ledgerPaths: string[];
  topics: StewardMaintainTopicPlan[];
};

type StewardSkillClusterPlan = {
  slug: string;
  title: string;
  candidateCount: number;
  score: number;
  ready: boolean;
  targetPath: string;
  action: "create" | "update" | "skip";
};

type StewardIncubateSkillsResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  workspaceDir: string;
  scannedCandidates: number;
  incubators: number;
  readyClusters: number;
  ledgerPaths: string[];
  clusters: StewardSkillClusterPlan[];
};

type StewardPromotedSkillPlan = {
  slug: string;
  title: string;
  candidateCount: number;
  score: number;
  sourcePath: string;
  targetPath: string;
  action: "create" | "update" | "skip";
};

type StewardPromoteSkillsResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  workspaceDir: string;
  scannedIncubators: number;
  promotedSkills: number;
  updatedSkills: number;
  skippedClusters: number;
  ledgerPaths: string[];
  skills: StewardPromotedSkillPlan[];
};

type StewardCycleResult = {
  runId: string;
  mode: "dry-run" | "apply";
  generatedAt: string;
  workspaceDir: string | null;
  ingest: StewardIngestResult | null;
  curate: StewardCurateResult | null;
  maintain: StewardMaintainResult | null;
  incubateSkills: StewardIncubateSkillsResult | null;
  promoteSkills: StewardPromoteSkillsResult | null;
};

type NormalizedTranscriptMessage = {
  role: string;
  text: string | null;
  toolNames: string[];
};

type ParsedStewardMemoryCandidate = {
  title: string;
  candidatePath: string;
  facts: string[];
  evidence: string[];
};

type ParsedStewardSkillCandidate = {
  title: string;
  candidatePath: string;
  slug: string;
  signals: string[];
  commands: string[];
  tools: string[];
  evidence: string[];
};

type ParsedStewardSkillIncubator = {
  title: string;
  slug: string;
  incubatorPath: string;
  candidateCount: number;
  score: number;
  commands: string[];
  tools: string[];
  signals: string[];
  sourceCandidates: string[];
};

type ParsedStewardTopicNote = {
  title: string;
  targetPath: string;
  facts: string[];
  evidence: string[];
  sourceCandidates: string[];
  relatedPaths: string[];
};

const DEFAULT_RECENT_LIMIT = 5;
const DEFAULT_CURATE_LIMIT = 20;
const DEFAULT_INCUBATE_LIMIT = 50;
const DEFAULT_PROMOTE_LIMIT = 50;
const DEFAULT_PROMOTE_MIN_CANDIDATES = 2;
const MAX_MEMORY_CANDIDATE_BYTES = 16 * 1024;
const MAX_SKILL_CANDIDATE_BYTES = 24 * 1024;
const MAX_CURATED_TOPIC_BYTES = 32 * 1024;
const MAX_SKILL_INCUBATOR_BYTES = 24 * 1024;
const MAX_PROMOTED_SKILL_BYTES = 24 * 1024;
const MAX_MEMORY_FACTS = 6;
const MAX_AUTOMATION_SIGNALS = 6;
const MAX_COMMAND_SNIPPETS = 8;
const MAX_TOOL_NAMES = 8;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_CURATED_EVIDENCE_ITEMS = 12;
const MAX_MAINTAIN_INLINE_EVIDENCE_ITEMS = 8;
const MAX_TEXT_CHARS = 220;
const STEWARD_MEMORY_ROOT_FILE = "MEMORY.md";
const STEWARD_LEDGER_PREFIX = "memory/steward/runs/";
const STEWARD_INBOX_PREFIX = "memory/inbox/";
const STEWARD_SKILL_PREFIX = "skills/_candidates/";
const STEWARD_SKILL_INCUBATOR_PREFIX = "skills/_incubator/";
const STEWARD_TOPICS_PREFIX = "memory/topics/";
const STEWARD_SKILLS_ROOT_PREFIX = "skills/";
const STEWARD_INGEST_ALLOWED_WRITE_PREFIXES = [
  STEWARD_LEDGER_PREFIX,
  STEWARD_INBOX_PREFIX,
  STEWARD_SKILL_PREFIX,
];
const STEWARD_CURATE_ALLOWED_WRITE_PREFIXES = [STEWARD_LEDGER_PREFIX, STEWARD_TOPICS_PREFIX];
const STEWARD_INCUBATE_ALLOWED_WRITE_PREFIXES = [
  STEWARD_LEDGER_PREFIX,
  STEWARD_SKILL_INCUBATOR_PREFIX,
];
const STEWARD_PROMOTE_ALLOWED_WRITE_PREFIXES = [
  STEWARD_LEDGER_PREFIX,
  STEWARD_SKILL_INCUBATOR_PREFIX,
  STEWARD_SKILLS_ROOT_PREFIX,
];
const STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES = [
  STEWARD_LEDGER_PREFIX,
  STEWARD_INBOX_PREFIX,
  STEWARD_SKILL_PREFIX,
  STEWARD_TOPICS_PREFIX,
];

const MEMORY_SIGNAL_PATTERNS = [
  /\bremember\b/i,
  /\bprefer\b/i,
  /\bpreference\b/i,
  /\bi want\b/i,
  /\bwe need\b/i,
  /\bshould\b/i,
  /\bdecision\b/i,
  /\bdeadline\b/i,
  /\bimportant\b/i,
  /\bkeep this\b/i,
  /\buse\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /记住/u,
  /偏好/u,
  /希望/u,
  /需要/u,
  /决定/u,
  /重要/u,
  /不要/u,
  /截止/u,
];

const SKILL_SIGNAL_PATTERNS = [
  /\bscript\b/i,
  /\bcli\b/i,
  /\bcommand\b/i,
  /\bworkflow\b/i,
  /\bautomation\b/i,
  /\bautomate\b/i,
  /\bskill\b/i,
  /\bhook\b/i,
  /\bcron\b/i,
  /\btool\b/i,
  /脚本/u,
  /命令/u,
  /流程/u,
  /自动化/u,
  /定时/u,
  /skill/u,
];

const COMMAND_PREFIX_RE =
  /^(?:\$ ?)?(?:openclaw|git|pnpm|npm|npx|node|uv|python(?:3)?|bash|sh|zellij|docker|kubectl|curl|gh|rg|jq|sed)\b/i;

function parsePositiveIntOption(
  raw: string | undefined,
  runtime: RuntimeEnv,
  flag: string,
): number | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    runtime.error(`${flag} must be a positive integer`);
    runtime.exit(1);
    return null;
  }
  return parsed;
}

function normalizeIsoDate(value: number | null | undefined, fallback: Date): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return fallback.toISOString();
}

function truncateText(value: string, maxChars: number = MAX_TEXT_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, maxChars);
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderFrontmatter(fields: Array<[string, string | number | boolean | string[]]>): string {
  const lines = ["---"];
  for (const [key, value] of fields) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const entry of value) {
        lines.push(`  - ${yamlString(entry)}`);
      }
      continue;
    }
    if (typeof value === "string") {
      lines.push(`${key}: ${yamlString(value)}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function buildSessionTitle(params: {
  firstUserMessage: string | null;
  lastMessagePreview: string | null;
  sessionKey: string;
}): string {
  const preferred = params.firstUserMessage ?? params.lastMessagePreview ?? params.sessionKey;
  return truncateText(preferred, 72);
}

function buildCandidateSlug(params: { title: string; sessionId: string }): string {
  const base = normalizeHyphenSlug(params.title);
  const compactSessionId = normalizeHyphenSlug(params.sessionId).replace(/-/g, "") || "session";
  const suffix = compactSessionId.slice(-8);
  if (!base) {
    return suffix;
  }
  return `${base}-${suffix}`;
}

function assertAllowedStewardRelativePath(
  relativePath: string,
  options?: {
    allowedPrefixes?: string[];
    allowedExactPaths?: string[];
  },
): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const allowedPrefixes = options?.allowedPrefixes ?? STEWARD_INGEST_ALLOWED_WRITE_PREFIXES;
  const allowedExactPaths = options?.allowedExactPaths ?? [];
  const allowed =
    allowedExactPaths.includes(normalized) ||
    allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
  if (!allowed) {
    throw new Error(`steward write path outside allowed roots: ${normalized}`);
  }
  return normalized;
}

function resolveStewardAbsolutePath(
  workspaceDir: string,
  relativePath: string,
  options?: {
    allowedPrefixes?: string[];
    allowedExactPaths?: string[];
  },
): string {
  const normalized = assertAllowedStewardRelativePath(relativePath, options);
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`steward write escaped workspace root: ${relativePath}`);
  }
  return target;
}

function resolveStewardWorkspaceDir(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  workspace?: string;
}): string {
  const explicitWorkspace = params.workspace?.trim();
  if (explicitWorkspace) {
    return path.resolve(resolveUserPath(explicitWorkspace));
  }
  return resolveAgentWorkspaceDir(params.cfg, params.agentId);
}

function toBudgetedMarkdown(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) {
    return text;
  }
  const marker =
    "\n\n> [!warning]\n> Steward truncated this candidate to stay inside its note budget.\n";
  let trimmed = text.trimEnd();
  while (trimmed.length > 0 && Buffer.byteLength(trimmed + marker, "utf-8") > maxBytes) {
    trimmed = trimmed.slice(0, Math.max(0, trimmed.length - 256)).trimEnd();
  }
  return `${trimmed}${marker}`;
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(content).text.trim();
    return stripped ? [stripped] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const text = (entry as { text?: unknown }).text;
      if (typeof text !== "string") {
        return "";
      }
      return stripInlineDirectiveTagsForDisplay(text).text.trim();
    })
    .filter(Boolean);
}

function normalizeTranscriptMessage(message: unknown): NormalizedTranscriptMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "other";
  if (role === "user" && hasInterSessionUserProvenance(record)) {
    return null;
  }
  const parts = extractTextParts(record.content);
  const directText =
    parts.length > 0
      ? parts.join("\n")
      : typeof record.text === "string"
        ? stripInlineDirectiveTagsForDisplay(record.text).text.trim()
        : "";
  const text = directText
    ? role === "user"
      ? stripEnvelope(directText).trim()
      : directText
    : null;
  const toolNames = extractToolCallNames(record);
  if (!text && toolNames.length === 0) {
    return null;
  }
  return {
    role,
    text: text && !text.startsWith("/") ? text : text,
    toolNames,
  };
}

function collectCommandSnippets(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }

    const inlineMatches = trimmed.match(/`([^`\n]{3,200})`/g) ?? [];
    for (const match of inlineMatches) {
      const candidate = match.slice(1, -1).trim();
      if (!COMMAND_PREFIX_RE.test(candidate) || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      out.push(truncateText(candidate, 180));
      if (out.length >= MAX_COMMAND_SNIPPETS) {
        return out;
      }
    }

    const lines = trimmed.split("\n").map((line) => line.trim());
    for (const line of lines) {
      const candidate = line.replace(/^\$\s*/, "").trim();
      if (!COMMAND_PREFIX_RE.test(candidate) || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      out.push(truncateText(candidate, 180));
      if (out.length >= MAX_COMMAND_SNIPPETS) {
        return out;
      }
    }
  }
  return out;
}

function collectSignalTexts(
  texts: string[],
  patterns: RegExp[],
  maxItems: number,
): { items: string[]; matched: boolean } {
  const seen = new Set<string>();
  const items: string[] = [];
  let matched = false;
  for (const text of texts) {
    if (!text.trim()) {
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(text))) {
      continue;
    }
    matched = true;
    const candidate = truncateText(text);
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    items.push(candidate);
    if (items.length >= maxItems) {
      break;
    }
  }
  return { items, matched };
}

function collectToolNames(messages: NormalizedTranscriptMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    for (const toolName of message.toolNames) {
      const normalized = toolName.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= MAX_TOOL_NAMES) {
        return out;
      }
    }
  }
  return out;
}

function buildEvidenceItems(messages: NormalizedTranscriptMessage[]): string[] {
  const evidence: string[] = [];
  for (const message of messages.slice(-MAX_EVIDENCE_ITEMS)) {
    if (message.text) {
      evidence.push(`${message.role}: ${truncateText(message.text, 260)}`);
      continue;
    }
    if (message.toolNames.length > 0) {
      evidence.push(`${message.role}: tool call ${message.toolNames.join(", ")}`);
    }
  }
  return evidence;
}

function buildMemoryCandidateContent(params: {
  title: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  sessionKind: StewardSessionKind;
  updatedAtIso: string;
  facts: string[];
  evidence: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-memory-candidate"],
    ["source", "openclaw-steward-ingest"],
    ["agent_id", params.agentId],
    ["session_key", params.sessionKey],
    ["session_id", params.sessionId],
    ["session_kind", params.sessionKind],
    ["updated_at", params.updatedAtIso],
    ["tags", ["steward/inbox", "candidate/memory", `session/${params.sessionKind}`]],
  ]);
  const lines = [
    frontmatter.trimEnd(),
    `# ${params.title}`,
    "",
    "Generated by `openclaw steward ingest` from a recent session. Review before promoting into long-term memory.",
    "",
    "## Candidate Durable Facts",
    ...params.facts.map((fact) => `- ${fact}`),
    "",
    "## Evidence",
    ...params.evidence.map((item) => `- ${item}`),
    "",
    "## Suggested Links",
    "- [[MEMORY]]",
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_MEMORY_CANDIDATE_BYTES);
}

function buildSkillCandidateContent(params: {
  title: string;
  slugBase: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  updatedAtIso: string;
  automationSignals: string[];
  commandSnippets: string[];
  toolNames: string[];
  evidence: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-skill-candidate"],
    ["source", "openclaw-steward-ingest"],
    ["agent_id", params.agentId],
    ["session_key", params.sessionKey],
    ["session_id", params.sessionId],
    ["updated_at", params.updatedAtIso],
    ["tags", ["steward/skills", "candidate/skill"]],
  ]);
  const lines = [
    frontmatter.trimEnd(),
    `# Skill Candidate: ${params.title}`,
    "",
    "Generated by `openclaw steward ingest`. This is a staged candidate, not a promoted workspace skill yet.",
    "",
    "## Why This Looks Reusable",
    ...(params.automationSignals.length > 0
      ? params.automationSignals.map((signal) => `- ${signal}`)
      : ["- Repeated commands/tools suggest a reusable workflow."]),
    "",
    "## Observed Commands",
    ...(params.commandSnippets.length > 0
      ? params.commandSnippets.map((snippet) => `- \`${snippet}\``)
      : ["- None captured in the transcript text."]),
    "",
    "## Observed Tools",
    ...(params.toolNames.length > 0
      ? params.toolNames.map((toolName) => `- \`${toolName}\``)
      : ["- None captured in the transcript."]),
    "",
    "## Proposed Promotion Sketch",
    `- Suggested slug: \`${params.slugBase}\``,
    "- Candidate output target: `skills/<slug>/SKILL.md`",
    "- Promotion rule: require repeated evidence across sessions before creating a real skill.",
    "",
    "## Evidence",
    ...params.evidence.map((item) => `- ${item}`),
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_SKILL_CANDIDATE_BYTES);
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractMarkdownHeading(content: string): string | null {
  for (const line of content.split(/\r?\n/u)) {
    if (line.startsWith("# ")) {
      const heading = line.slice(2).trim();
      return heading || null;
    }
  }
  return null;
}

function extractMarkdownBulletSection(content: string, heading: string): string[] {
  const lines = content.split(/\r?\n/u);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex < 0) {
    return [];
  }
  const items: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      break;
    }
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return dedupePreserveOrder(items);
}

function stripMarkdownExtension(relativePath: string): string {
  return relativePath.replace(/\.md$/iu, "");
}

function listMarkdownFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdownFilesRecursive(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
}

function parseStewardMemoryCandidate(params: {
  workspaceDir: string;
  absolutePath: string;
}): ParsedStewardMemoryCandidate | null {
  const content = fs.readFileSync(params.absolutePath, "utf-8");
  if (!content.includes('type: "steward-memory-candidate"')) {
    return null;
  }
  const facts = extractMarkdownBulletSection(content, "## Candidate Durable Facts");
  if (facts.length === 0) {
    return null;
  }
  const candidatePath = path.relative(params.workspaceDir, params.absolutePath).replace(/\\/g, "/");
  const fallbackTitle = path.basename(candidatePath, path.extname(candidatePath));
  return {
    title: extractMarkdownHeading(content) ?? fallbackTitle,
    candidatePath,
    facts,
    evidence: extractMarkdownBulletSection(content, "## Evidence"),
  };
}

function unwrapInlineCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractSuggestedSlug(content: string): string | null {
  const match = content.match(/Suggested slug:\s*`([^`]+)`/u);
  const raw = match?.[1]?.trim();
  return raw ? raw : null;
}

function parseStewardSkillCandidate(params: {
  workspaceDir: string;
  absolutePath: string;
}): ParsedStewardSkillCandidate | null {
  const content = fs.readFileSync(params.absolutePath, "utf-8");
  if (!content.includes('type: "steward-skill-candidate"')) {
    return null;
  }
  const candidatePath = path.relative(params.workspaceDir, params.absolutePath).replace(/\\/g, "/");
  const heading =
    extractMarkdownHeading(content) ?? path.basename(candidatePath, path.extname(candidatePath));
  const title = heading.replace(/^Skill Candidate:\s*/u, "").trim() || heading;
  const slug =
    extractSuggestedSlug(content) ??
    normalizeHyphenSlug(title) ??
    normalizeHyphenSlug(path.basename(candidatePath, path.extname(candidatePath))) ??
    "steward-skill";
  const commands = extractMarkdownBulletSection(content, "## Observed Commands")
    .map(unwrapInlineCode)
    .filter((entry) => entry && entry !== "None captured in the transcript text.");
  const tools = extractMarkdownBulletSection(content, "## Observed Tools")
    .map(unwrapInlineCode)
    .filter((entry) => entry && entry !== "None captured in the transcript.");
  return {
    title,
    candidatePath,
    slug,
    signals: extractMarkdownBulletSection(content, "## Why This Looks Reusable").filter(
      (entry) => entry && !entry.startsWith("Repeated commands/tools"),
    ),
    commands,
    tools,
    evidence: extractMarkdownBulletSection(content, "## Evidence"),
  };
}

function buildTopicEvidenceChunkPath(targetPath: string): string {
  const stem = path.basename(targetPath, ".md");
  return assertAllowedStewardRelativePath(`${STEWARD_TOPICS_PREFIX}${stem}-evidence.md`, {
    allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
  });
}

function buildTopicEvidenceChunkContent(params: {
  title: string;
  parentPath: string;
  chunkPath: string;
  generatedAt: string;
  evidence: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-topic-evidence"],
    ["source", "openclaw-steward-maintain"],
    ["updated_at", params.generatedAt],
    ["parent_topic", params.parentPath],
    ["tags", ["steward/topic", "memory/evidence"]],
  ]);
  const lines = [
    frontmatter.trimEnd(),
    `# ${params.title} Evidence`,
    "",
    "Additional evidence split out by `openclaw steward maintain` to keep the parent topic concise.",
    "",
    "## Evidence",
    ...params.evidence.map((item) => `- ${item}`),
    "",
    "## Parent Topic",
    `- [[${stripMarkdownExtension(params.parentPath)}]]`,
    `- [[${stripMarkdownExtension(params.chunkPath)}]]`,
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_CURATED_TOPIC_BYTES);
}

function buildSkillIncubatorPath(slug: string): string {
  return assertAllowedStewardRelativePath(`${STEWARD_SKILL_INCUBATOR_PREFIX}${slug}.md`, {
    allowedPrefixes: STEWARD_INCUBATE_ALLOWED_WRITE_PREFIXES,
  });
}

function computeSkillClusterScore(params: {
  candidateCount: number;
  commands: string[];
  tools: string[];
  signals: string[];
}): number {
  return Math.min(
    10,
    params.candidateCount * 2 +
      Math.min(3, params.commands.length) +
      Math.min(2, params.tools.length) +
      Math.min(3, params.signals.length),
  );
}

function buildSkillIncubatorContent(params: {
  title: string;
  slug: string;
  generatedAt: string;
  candidatePaths: string[];
  score: number;
  signals: string[];
  commands: string[];
  tools: string[];
  evidence: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-skill-incubator"],
    ["source", "openclaw-steward-incubate-skills"],
    ["slug", params.slug],
    ["updated_at", params.generatedAt],
    ["candidate_count", params.candidatePaths.length],
    ["score", params.score],
    ["tags", ["steward/skills", "incubator"]],
  ]);
  const lines = [
    frontmatter.trimEnd(),
    `# Skill Incubator: ${params.title}`,
    "",
    "Generated by `openclaw steward incubate-skills` from repeated staged skill candidates.",
    "",
    "## Readiness",
    `- Candidate count: ${params.candidatePaths.length}`,
    `- Score: ${params.score}`,
    `- Ready to promote: ${params.candidatePaths.length >= DEFAULT_PROMOTE_MIN_CANDIDATES ? "yes" : "no"}`,
    "",
    "## Why This Looks Reusable",
    ...(params.signals.length > 0
      ? params.signals.map((signal) => `- ${signal}`)
      : ["- Repeated commands/tools suggest a stable workflow."]),
    "",
    "## Observed Commands",
    ...(params.commands.length > 0
      ? params.commands.map((command) => `- \`${command}\``)
      : ["- No reusable commands extracted yet."]),
    "",
    "## Observed Tools",
    ...(params.tools.length > 0
      ? params.tools.map((toolName) => `- \`${toolName}\``)
      : ["- No tools extracted yet."]),
    "",
    "## Source Candidates",
    ...params.candidatePaths.map(
      (candidatePath) => `- [[${stripMarkdownExtension(candidatePath)}]]`,
    ),
    "",
    "## Evidence",
    ...params.evidence.map((item) => `- ${item}`),
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_SKILL_INCUBATOR_BYTES);
}

function parseStewardSkillIncubator(params: {
  workspaceDir: string;
  absolutePath: string;
}): ParsedStewardSkillIncubator | null {
  const content = fs.readFileSync(params.absolutePath, "utf-8");
  if (!content.includes('type: "steward-skill-incubator"')) {
    return null;
  }
  const incubatorPath = path.relative(params.workspaceDir, params.absolutePath).replace(/\\/g, "/");
  const heading =
    extractMarkdownHeading(content) ?? path.basename(incubatorPath, path.extname(incubatorPath));
  const title = heading.replace(/^Skill Incubator:\s*/u, "").trim() || heading;
  const scoreMatch = content.match(/^score:\s*(\d+)/mu);
  const countMatch = content.match(/^candidate_count:\s*(\d+)/mu);
  return {
    title,
    slug:
      normalizeHyphenSlug(
        extractSuggestedSlug(content) ?? path.basename(incubatorPath, path.extname(incubatorPath)),
      ) || "steward-skill",
    incubatorPath,
    candidateCount: Number.parseInt(countMatch?.[1] ?? "0", 10) || 0,
    score: Number.parseInt(scoreMatch?.[1] ?? "0", 10) || 0,
    commands: extractMarkdownBulletSection(content, "## Observed Commands")
      .map(unwrapInlineCode)
      .filter((entry) => entry && entry !== "No reusable commands extracted yet."),
    tools: extractMarkdownBulletSection(content, "## Observed Tools")
      .map(unwrapInlineCode)
      .filter((entry) => entry && entry !== "No tools extracted yet."),
    signals: extractMarkdownBulletSection(content, "## Why This Looks Reusable").filter(Boolean),
    sourceCandidates: extractMarkdownBulletSection(content, "## Source Candidates").map((entry) =>
      entry.replace(/^\[\[|\]\]$/g, ""),
    ),
  };
}

function buildPromotedSkillPath(slug: string): string {
  return assertAllowedStewardRelativePath(`${STEWARD_SKILLS_ROOT_PREFIX}${slug}/SKILL.md`, {
    allowedPrefixes: STEWARD_PROMOTE_ALLOWED_WRITE_PREFIXES,
  });
}

function buildPromotedSkillContent(params: {
  slug: string;
  title: string;
  generatedAt: string;
  candidateCount: number;
  score: number;
  signals: string[];
  commands: string[];
  tools: string[];
  sourceCandidates: string[];
}): string {
  const description = truncateText(
    params.signals[0] ??
      `Reusable automation workflow distilled from ${params.candidateCount} steward candidates.`,
    160,
  );
  const frontmatter = [
    "---",
    `name: ${params.slug}`,
    `description: ${yamlString(description)}`,
    "---",
    "",
  ].join("\n");
  const lines = [
    frontmatter.trimEnd(),
    `# ${params.title}`,
    "",
    "Generated by `openclaw steward promote-skills` from incubated workspace evidence.",
    "",
    "## When To Use",
    ...(params.signals.length > 0
      ? params.signals.map((signal) => `- ${signal}`)
      : ["- Use when this repeated workflow appears again."]),
    "",
    "## Suggested Workflow",
    ...(params.commands.length > 0
      ? params.commands.map((command) => `- Run \`${command}\``)
      : ["- Review source candidates and adapt the workflow manually."]),
    "",
    "## Tools",
    ...(params.tools.length > 0 ? params.tools.map((toolName) => `- \`${toolName}\``) : ["- None"]),
    "",
    "## Guardrails",
    "- Review destructive commands before execution.",
    "- Keep workspace-specific paths and credentials out of the skill body unless they are stable.",
    `- Promotion evidence: ${params.candidateCount} candidate(s), score ${params.score}.`,
    "",
    "## Source Candidates",
    ...params.sourceCandidates.map(
      (candidatePath) => `- [[${stripMarkdownExtension(candidatePath)}]]`,
    ),
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_PROMOTED_SKILL_BYTES);
}

function buildCuratedTopicPath(params: { title: string; candidatePath: string }): string {
  const base =
    normalizeHyphenSlug(params.title) ||
    normalizeHyphenSlug(path.basename(params.candidatePath, path.extname(params.candidatePath))) ||
    "steward-topic";
  return assertAllowedStewardRelativePath(`${STEWARD_TOPICS_PREFIX}${base}.md`, {
    allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
  });
}

function buildCuratedTopicContent(params: {
  title: string;
  generatedAt: string;
  facts: string[];
  evidence: string[];
  sourceCandidates: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-topic-note"],
    ["source", "openclaw-steward-curate"],
    ["updated_at", params.generatedAt],
    ["aliases", [params.title]],
    ["curated_from", params.sourceCandidates],
    ["tags", ["steward/topic", "memory/curated"]],
  ]);
  const lines = [
    frontmatter.trimEnd(),
    `# ${params.title}`,
    "",
    "Curated by `openclaw steward curate` from steward inbox candidates.",
    "",
    "## Durable Facts",
    ...params.facts.map((fact) => `- ${fact}`),
    "",
    "## Supporting Evidence",
    ...(params.evidence.length > 0
      ? params.evidence.map((item) => `- ${item}`)
      : ["- No supporting evidence captured yet."]),
    "",
    "## Source Candidates",
    ...params.sourceCandidates.map(
      (candidatePath) => `- [[${stripMarkdownExtension(candidatePath)}]]`,
    ),
    "",
    "## Related",
    "- [[MEMORY]]",
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_CURATED_TOPIC_BYTES);
}

function upsertMemoryIndexContent(params: {
  existingContent: string | null;
  links: Array<{ title: string; targetPath: string }>;
}): { content: string; updated: boolean } {
  const nextLinks = dedupePreserveOrder(
    params.links.map(
      (entry) =>
        `- [[${stripMarkdownExtension(entry.targetPath)}|${truncateText(entry.title, 72)}]]`,
    ),
  );
  if (nextLinks.length === 0) {
    return { content: params.existingContent ?? "# MEMORY\n", updated: false };
  }
  const existingContent = params.existingContent ?? "# MEMORY\n";
  const lines = existingContent.split(/\r?\n/u);
  const heading = "## Curated Topics";
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) {
    const suffix = existingContent.trimEnd();
    const content = `${suffix}${suffix ? "\n\n" : ""}${heading}\n${nextLinks.join("\n")}\n`;
    return { content, updated: content !== existingContent };
  }

  const sectionStart = headingIndex + 1;
  let sectionEnd = lines.length;
  for (let index = sectionStart; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().startsWith("## ")) {
      sectionEnd = index;
      break;
    }
  }
  const existingSectionLinks = lines
    .slice(sectionStart, sectionEnd)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  const mergedLinks = dedupePreserveOrder([...existingSectionLinks, ...nextLinks]);
  const rebuilt = [
    ...lines.slice(0, sectionStart),
    ...mergedLinks,
    ...lines.slice(sectionEnd),
  ].join("\n");
  const content = rebuilt.endsWith("\n") ? rebuilt : `${rebuilt}\n`;
  return { content, updated: content !== existingContent };
}

function buildRelativeCandidatePath(params: {
  prefix: string;
  updatedAtIso: string;
  slug: string;
}): string {
  const dateDir = params.updatedAtIso.slice(0, 10);
  return assertAllowedStewardRelativePath(`${params.prefix}${dateDir}/${params.slug}.md`);
}

function buildStewardLedgerPath(runDateIso: string): string {
  return assertAllowedStewardRelativePath(
    `${STEWARD_LEDGER_PREFIX}${runDateIso.slice(0, 10)}.jsonl`,
  );
}

function classifyStewardSessionKind(key: string, entry: SessionEntry): StewardSessionKind {
  return classifySessionKey(key, entry);
}

function sortSessionPlans(a: StewardSessionPlan, b: StewardSessionPlan): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.key.localeCompare(b.key);
}

async function writeStewardCandidateFile(params: {
  workspaceDir: string;
  relativePath: string;
  content: string;
  allowedPrefixes?: string[];
  allowedExactPaths?: string[];
}): Promise<void> {
  const absolutePath = resolveStewardAbsolutePath(params.workspaceDir, params.relativePath, {
    allowedPrefixes: params.allowedPrefixes,
    allowedExactPaths: params.allowedExactPaths,
  });
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, params.content, "utf-8");
}

async function appendStewardLedger(params: {
  workspaceDir: string;
  ledgerPath: string;
  entry: Record<string, unknown>;
}): Promise<void> {
  const absolutePath = resolveStewardAbsolutePath(params.workspaceDir, params.ledgerPath, {
    allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
  });
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const payload = JSON.stringify(params.entry);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) {
    fs.writeFileSync(absolutePath, payload, "utf-8");
    return;
  }
  const prefix = fs.readFileSync(absolutePath, "utf-8").endsWith("\n") ? "" : "\n";
  fs.appendFileSync(absolutePath, `${prefix}${payload}`, "utf-8");
}

function renderTextResult(result: StewardIngestResult, runtime: RuntimeEnv): void {
  runtime.log(
    `Knowledge steward ingest (${result.mode}) - scanned ${result.scannedSessions}, kept ${result.keptSessions}, discarded ${result.discardedSessions}`,
  );
  runtime.log(`Memory candidates: ${result.memoryCandidates}`);
  runtime.log(`Skill candidates: ${result.skillCandidates}`);
  if (result.ledgerPaths.length > 0) {
    runtime.log(`Ledgers updated: ${result.ledgerPaths.length}`);
    for (const ledgerPath of result.ledgerPaths) {
      runtime.log(`- ${ledgerPath}`);
    }
  }
  if (result.sessions.length === 0) {
    runtime.log("No recent sessions matched the selection.");
    return;
  }
  runtime.log("Session decisions:");
  for (const session of result.sessions) {
    const parts = [`- ${session.decision.toUpperCase()} ${session.key}`];
    if (session.memoryCandidate) {
      parts.push(`memory -> ${session.memoryCandidate.path}`);
    }
    if (session.skillCandidate) {
      parts.push(`skill -> ${session.skillCandidate.path}`);
    }
    if (session.reasons.length > 0) {
      parts.push(`reasons: ${session.reasons.join("; ")}`);
    }
    runtime.log(parts.join(" | "));
  }
}

function renderCurateTextResult(result: StewardCurateResult, runtime: RuntimeEnv): void {
  runtime.log(
    `Knowledge steward curate (${result.mode}) - scanned ${result.scannedCandidates}, curated ${result.curatedCandidates}`,
  );
  runtime.log(`Created notes: ${result.createdNotes}`);
  runtime.log(`Updated notes: ${result.updatedNotes}`);
  runtime.log(`Memory index updated: ${result.memoryIndexUpdated ? "yes" : "no"}`);
  if (result.ledgerPaths.length > 0) {
    runtime.log(`Ledgers updated: ${result.ledgerPaths.length}`);
    for (const ledgerPath of result.ledgerPaths) {
      runtime.log(`- ${ledgerPath}`);
    }
  }
  if (result.candidates.length === 0) {
    runtime.log("No steward inbox candidates were found.");
    return;
  }
  runtime.log("Candidate decisions:");
  for (const candidate of result.candidates) {
    runtime.log(
      `- ${candidate.action.toUpperCase()} ${candidate.candidatePath} -> ${candidate.targetPath} | facts +${candidate.factsAdded}, evidence +${candidate.evidenceAdded}`,
    );
  }
}

function selectRecentSessions(rows: StewardIngestRow[], recentLimit: number): StewardIngestRow[] {
  return rows
    .toSorted((a, b) => (b.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0))
    .slice(0, recentLimit);
}

function prepareStewardSession(row: StewardIngestRow, now: Date): StewardPreparedSession | null {
  if (!row.entry.sessionId) {
    return null;
  }

  const titleFields = readSessionTitleFieldsFromTranscript(
    row.entry.sessionId,
    row.storePath,
    row.entry.sessionFile,
    row.agentId,
  );
  const previewItems = readSessionPreviewItemsFromTranscript(
    row.entry.sessionId,
    row.storePath,
    row.entry.sessionFile,
    row.agentId,
    3,
    120,
  );
  const transcriptMessages = readSessionMessages(
    row.entry.sessionId,
    row.storePath,
    row.entry.sessionFile,
  )
    .map((message) => normalizeTranscriptMessage(message))
    .filter((message): message is NormalizedTranscriptMessage => Boolean(message));
  const textMessages = transcriptMessages.filter((message) => Boolean(message.text));
  const userTexts = textMessages
    .filter((message) => message.role === "user" && Boolean(message.text))
    .map((message) => message.text ?? "");
  const visibleTexts = textMessages.map((message) => message.text ?? "").filter(Boolean);

  const title = buildSessionTitle({
    firstUserMessage: titleFields.firstUserMessage,
    lastMessagePreview: titleFields.lastMessagePreview,
    sessionKey: row.key,
  });
  const updatedAtIso = normalizeIsoDate(row.entry.updatedAt ?? null, now);
  const slug = buildCandidateSlug({
    title,
    sessionId: row.entry.sessionId,
  });
  const memorySignals = collectSignalTexts(userTexts, MEMORY_SIGNAL_PATTERNS, MAX_MEMORY_FACTS);
  const automationSignals = collectSignalTexts(
    userTexts,
    SKILL_SIGNAL_PATTERNS,
    MAX_AUTOMATION_SIGNALS,
  );
  const commandSnippets = collectCommandSnippets(visibleTexts);
  const toolNames = collectToolNames(transcriptMessages);
  const evidence = buildEvidenceItems(textMessages);

  const reasons: string[] = [];
  if (memorySignals.matched) {
    reasons.push("durable-memory signals found");
  }
  if (automationSignals.matched) {
    reasons.push("automation/skill signals found");
  }
  if (commandSnippets.length > 0) {
    reasons.push(`${commandSnippets.length} command snippet(s) found`);
  }
  if (toolNames.length > 0) {
    reasons.push(`${toolNames.length} tool call(s) found`);
  }

  const memoryContent =
    memorySignals.items.length > 0
      ? buildMemoryCandidateContent({
          title,
          agentId: row.agentId,
          sessionKey: row.key,
          sessionId: row.entry.sessionId,
          sessionKind: classifyStewardSessionKind(row.key, row.entry),
          updatedAtIso,
          facts: memorySignals.items,
          evidence,
        })
      : null;
  const memoryCandidate =
    memoryContent !== null
      ? {
          kind: "memory" as const,
          path: buildRelativeCandidatePath({
            prefix: STEWARD_INBOX_PREFIX,
            updatedAtIso,
            slug,
          }),
          title,
          bytes: Buffer.byteLength(memoryContent, "utf-8"),
        }
      : null;

  const skillContent =
    automationSignals.items.length > 0 || commandSnippets.length > 0 || toolNames.length > 0
      ? buildSkillCandidateContent({
          title,
          slugBase: normalizeHyphenSlug(title) || slug,
          agentId: row.agentId,
          sessionKey: row.key,
          sessionId: row.entry.sessionId,
          updatedAtIso,
          automationSignals: automationSignals.items,
          commandSnippets,
          toolNames,
          evidence,
        })
      : null;
  const skillCandidate =
    skillContent !== null
      ? {
          kind: "skill" as const,
          path: buildRelativeCandidatePath({
            prefix: STEWARD_SKILL_PREFIX,
            updatedAtIso,
            slug,
          }),
          title,
          bytes: Buffer.byteLength(skillContent, "utf-8"),
        }
      : null;

  return {
    session: {
      key: row.key,
      agentId: row.agentId,
      workspaceDir: row.workspaceDir,
      storePath: row.storePath ?? "",
      kind: classifyStewardSessionKind(row.key, row.entry),
      sessionId: row.entry.sessionId,
      updatedAt: row.entry.updatedAt ?? null,
      decision: memoryCandidate || skillCandidate ? "keep" : "discard",
      reasons:
        memoryCandidate || skillCandidate ? reasons : ["no durable memory or automation signals"],
      previewItems,
      firstUserMessage: titleFields.firstUserMessage,
      lastMessagePreview: titleFields.lastMessagePreview,
      memoryCandidate,
      skillCandidate,
    },
    memoryContent,
    skillContent,
  };
}

async function appendStewardIngestLedgers(result: StewardIngestResult): Promise<void> {
  const byWorkspace = new Map<string, WorkspaceLedgerSummary>();
  for (const session of result.sessions) {
    const existing = byWorkspace.get(session.workspaceDir) ?? {
      workspaceDir: session.workspaceDir,
      agentIds: [],
      sessionCount: 0,
      keptCount: 0,
      discardedCount: 0,
      memoryCandidates: [],
      skillCandidates: [],
    };
    existing.sessionCount += 1;
    if (!existing.agentIds.includes(session.agentId)) {
      existing.agentIds.push(session.agentId);
    }
    if (session.decision === "keep") {
      existing.keptCount += 1;
    } else {
      existing.discardedCount += 1;
    }
    if (session.memoryCandidate) {
      existing.memoryCandidates.push(session.memoryCandidate.path);
    }
    if (session.skillCandidate) {
      existing.skillCandidates.push(session.skillCandidate.path);
    }
    byWorkspace.set(session.workspaceDir, existing);
  }

  for (const summary of byWorkspace.values()) {
    const ledgerPath = buildStewardLedgerPath(result.generatedAt);
    await appendStewardLedger({
      workspaceDir: summary.workspaceDir,
      ledgerPath,
      entry: {
        runId: result.runId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        workspaceDir: summary.workspaceDir,
        agentIds: summary.agentIds,
        sessionCount: summary.sessionCount,
        keptCount: summary.keptCount,
        discardedCount: summary.discardedCount,
        memoryCandidates: summary.memoryCandidates,
        skillCandidates: summary.skillCandidates,
      },
    });
    result.ledgerPaths.push(path.join(summary.workspaceDir, ledgerPath));
  }
}

export async function stewardIngestExplicitSession(params: {
  sessionKey: string;
  agentId: string;
  workspaceDir: string;
  entry: SessionEntry;
  storePath?: string;
  apply?: boolean;
}): Promise<StewardIngestResult> {
  const now = new Date();
  const prepared = prepareStewardSession(
    {
      key: params.sessionKey,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      storePath: params.storePath,
      entry: params.entry,
    },
    now,
  );
  const sessions = prepared ? [prepared.session] : [];
  const result: StewardIngestResult = {
    runId: randomUUID(),
    mode: params.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    scannedSessions: prepared ? 1 : 0,
    selectedSessions: prepared ? 1 : 0,
    keptSessions: sessions.filter((session) => session.decision === "keep").length,
    discardedSessions: sessions.filter((session) => session.decision === "discard").length,
    memoryCandidates: sessions.filter((session) => session.memoryCandidate).length,
    skillCandidates: sessions.filter((session) => session.skillCandidate).length,
    ledgerPaths: [],
    sessions: sessions.toSorted(sortSessionPlans),
  };

  if (params.apply === true && prepared) {
    if (prepared.session.memoryCandidate && prepared.memoryContent) {
      await writeStewardCandidateFile({
        workspaceDir: params.workspaceDir,
        relativePath: prepared.session.memoryCandidate.path,
        content: prepared.memoryContent,
      });
    }
    if (prepared.session.skillCandidate && prepared.skillContent) {
      await writeStewardCandidateFile({
        workspaceDir: params.workspaceDir,
        relativePath: prepared.session.skillCandidate.path,
        content: prepared.skillContent,
      });
    }
    await appendStewardIngestLedgers(result);
  }

  return result;
}

export async function stewardIngestCommand(
  opts: StewardIngestOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const activeMinutes = parsePositiveIntOption(opts.active, runtime, "--active");
  if (activeMinutes === null) {
    return;
  }
  const recentLimit = parsePositiveIntOption(opts.recent, runtime, "--recent");
  if (recentLimit === null) {
    return;
  }
  const now = new Date();
  const targets = resolveSessionStoreTargetsOrExit({
    cfg,
    opts: {
      store: opts.store,
      agent: opts.agent,
      allAgents: Boolean(opts.allAgents),
    },
    runtime,
  });
  if (!targets) {
    return;
  }

  const sessionRows: StewardIngestRow[] = [];

  for (const target of targets) {
    const workspaceDir = resolveStewardWorkspaceDir({
      cfg,
      agentId: target.agentId,
      workspace: opts.workspace,
    });
    const store = loadSessionStore(target.storePath);
    for (const [key, entry] of Object.entries(store)) {
      if (!entry?.sessionId) {
        continue;
      }
      const updatedAt = entry.updatedAt ?? 0;
      if (
        activeMinutes !== undefined &&
        updatedAt > 0 &&
        Date.now() - updatedAt > activeMinutes * 60_000
      ) {
        continue;
      }
      sessionRows.push({
        key,
        agentId: target.agentId,
        workspaceDir,
        storePath: target.storePath,
        entry,
      });
    }
  }

  const selected = selectRecentSessions(sessionRows, recentLimit ?? DEFAULT_RECENT_LIMIT);
  const preparedSessions = selected
    .map((row) => prepareStewardSession(row, now))
    .filter((prepared): prepared is StewardPreparedSession => Boolean(prepared));

  for (const prepared of preparedSessions) {
    if (opts.apply !== true) {
      continue;
    }
    if (prepared.session.memoryCandidate && prepared.memoryContent) {
      await writeStewardCandidateFile({
        workspaceDir: prepared.session.workspaceDir,
        relativePath: prepared.session.memoryCandidate.path,
        content: prepared.memoryContent,
      });
    }
    if (prepared.session.skillCandidate && prepared.skillContent) {
      await writeStewardCandidateFile({
        workspaceDir: prepared.session.workspaceDir,
        relativePath: prepared.session.skillCandidate.path,
        content: prepared.skillContent,
      });
    }
  }

  const result: StewardIngestResult = {
    runId: randomUUID(),
    mode: opts.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    scannedSessions: sessionRows.length,
    selectedSessions: selected.length,
    keptSessions: preparedSessions.filter((prepared) => prepared.session.decision === "keep")
      .length,
    discardedSessions: preparedSessions.filter(
      (prepared) => prepared.session.decision === "discard",
    ).length,
    memoryCandidates: preparedSessions.filter((prepared) => prepared.session.memoryCandidate)
      .length,
    skillCandidates: preparedSessions.filter((prepared) => prepared.session.skillCandidate).length,
    ledgerPaths: [],
    sessions: preparedSessions.map((prepared) => prepared.session).toSorted(sortSessionPlans),
  };

  if (opts.apply === true) {
    await appendStewardIngestLedgers(result);
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  renderTextResult(result, runtime);
}

export async function stewardCurateCommand(
  opts: StewardCurateOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const limit = parsePositiveIntOption(opts.limit, runtime, "--limit");
  if (limit === null) {
    return;
  }
  const now = new Date();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveStewardWorkspaceDir({
    cfg,
    agentId,
    workspace: opts.workspace,
  });
  const inboxRoot = path.join(workspaceDir, "memory", "inbox");
  const candidateFiles = listMarkdownFilesRecursive(inboxRoot)
    .toSorted((left, right) => right.localeCompare(left))
    .slice(0, limit ?? DEFAULT_CURATE_LIMIT);
  const parsedCandidates = candidateFiles
    .map((absolutePath) => parseStewardMemoryCandidate({ workspaceDir, absolutePath }))
    .filter((candidate): candidate is ParsedStewardMemoryCandidate => Boolean(candidate));

  const candidatePlans: StewardCurateCandidatePlan[] = [];
  const topicWrites = new Map<
    string,
    {
      title: string;
      content: string;
      action: "create" | "update" | "skip";
    }
  >();
  const memoryIndexLinks = new Map<string, { title: string; targetPath: string }>();

  for (const candidate of parsedCandidates) {
    const targetPath = buildCuratedTopicPath({
      title: candidate.title,
      candidatePath: candidate.candidatePath,
    });
    const absoluteTargetPath = resolveStewardAbsolutePath(workspaceDir, targetPath, {
      allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
    });
    const existingContent = fs.existsSync(absoluteTargetPath)
      ? fs.readFileSync(absoluteTargetPath, "utf-8")
      : null;
    const pending = topicWrites.get(targetPath);
    const priorContent = pending?.content ?? existingContent;
    const existingFacts = priorContent
      ? extractMarkdownBulletSection(priorContent, "## Durable Facts")
      : [];
    const existingEvidence = priorContent
      ? extractMarkdownBulletSection(priorContent, "## Supporting Evidence")
      : [];
    const existingSources = priorContent
      ? extractMarkdownBulletSection(priorContent, "## Source Candidates").map((item) =>
          item.replace(/^\[\[|\]\]$/g, ""),
        )
      : [];
    const facts = dedupePreserveOrder([...existingFacts, ...candidate.facts]);
    const evidence = dedupePreserveOrder([...existingEvidence, ...candidate.evidence]).slice(
      0,
      MAX_CURATED_EVIDENCE_ITEMS,
    );
    const sourceCandidates = dedupePreserveOrder([
      ...existingSources,
      ...(candidate.candidatePath ? [candidate.candidatePath] : []),
    ]);
    const factsAdded = Math.max(0, facts.length - existingFacts.length);
    const evidenceAdded = Math.max(0, evidence.length - existingEvidence.length);
    const sourceCandidatesAdded = Math.max(0, sourceCandidates.length - existingSources.length);
    const nextContent = buildCuratedTopicContent({
      title: candidate.title,
      generatedAt: now.toISOString(),
      facts,
      evidence,
      sourceCandidates,
    });
    const changed =
      pending?.action === "create" ||
      existingContent === null ||
      factsAdded > 0 ||
      evidenceAdded > 0 ||
      sourceCandidatesAdded > 0;
    const action =
      pending?.action === "create"
        ? "create"
        : existingContent === null
          ? "create"
          : changed
            ? "update"
            : "skip";
    topicWrites.set(targetPath, {
      title: candidate.title,
      content: nextContent,
      action,
    });
    memoryIndexLinks.set(targetPath, { title: candidate.title, targetPath });
    candidatePlans.push({
      candidatePath: candidate.candidatePath,
      targetPath,
      title: candidate.title,
      action,
      factsAdded,
      evidenceAdded,
      sourceCandidatesAdded,
    });
  }

  const memoryIndexPath = STEWARD_MEMORY_ROOT_FILE;
  const absoluteMemoryIndexPath = resolveStewardAbsolutePath(workspaceDir, memoryIndexPath, {
    allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
    allowedExactPaths: [STEWARD_MEMORY_ROOT_FILE],
  });
  const existingMemoryIndex = fs.existsSync(absoluteMemoryIndexPath)
    ? fs.readFileSync(absoluteMemoryIndexPath, "utf-8")
    : null;
  const memoryIndexUpdate = upsertMemoryIndexContent({
    existingContent: existingMemoryIndex,
    links: Array.from(memoryIndexLinks.values()).toSorted((left, right) =>
      left.title.localeCompare(right.title),
    ),
  });

  if (opts.apply === true) {
    for (const [targetPath, write] of topicWrites) {
      if (write.action === "skip") {
        continue;
      }
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: targetPath,
        content: write.content,
        allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
      });
    }
    if (memoryIndexUpdate.updated) {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: memoryIndexPath,
        content: memoryIndexUpdate.content,
        allowedPrefixes: STEWARD_CURATE_ALLOWED_WRITE_PREFIXES,
        allowedExactPaths: [STEWARD_MEMORY_ROOT_FILE],
      });
    }
  }

  const topicWriteSummary = Array.from(topicWrites.values());

  const result: StewardCurateResult = {
    runId: randomUUID(),
    mode: opts.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    workspaceDir,
    scannedCandidates: candidateFiles.length,
    curatedCandidates: candidatePlans.filter((candidate) => candidate.action !== "skip").length,
    createdNotes: topicWriteSummary.filter((write) => write.action === "create").length,
    updatedNotes: topicWriteSummary.filter((write) => write.action === "update").length,
    memoryIndexUpdated: memoryIndexUpdate.updated,
    ledgerPaths: [],
    candidates: candidatePlans,
  };

  if (opts.apply === true) {
    const ledgerPath = buildStewardLedgerPath(result.generatedAt);
    await appendStewardLedger({
      workspaceDir,
      ledgerPath,
      entry: {
        command: "curate",
        runId: result.runId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        workspaceDir,
        scannedCandidates: result.scannedCandidates,
        curatedCandidates: result.curatedCandidates,
        createdNotes: result.createdNotes,
        updatedNotes: result.updatedNotes,
        memoryIndexUpdated: result.memoryIndexUpdated,
        candidatePaths: result.candidates.map((candidate) => candidate.candidatePath),
        targetPaths: result.candidates
          .filter((candidate) => candidate.action !== "skip")
          .map((candidate) => candidate.targetPath),
      },
    });
    result.ledgerPaths.push(path.join(workspaceDir, ledgerPath));
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  renderCurateTextResult(result, runtime);
}

function extractWikiLinkTarget(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/u);
  return (match?.[1] ?? trimmed).trim();
}

function normalizeRelatedNotePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "MEMORY" || trimmed === STEWARD_MEMORY_ROOT_FILE) {
    return STEWARD_MEMORY_ROOT_FILE;
  }
  return trimmed;
}

function parseStewardTopicNote(params: {
  workspaceDir: string;
  absolutePath: string;
}): ParsedStewardTopicNote | null {
  const content = fs.readFileSync(params.absolutePath, "utf-8");
  if (!content.includes('type: "steward-topic-note"')) {
    return null;
  }
  const targetPath = path.relative(params.workspaceDir, params.absolutePath).replace(/\\/g, "/");
  const fallbackTitle = path.basename(targetPath, path.extname(targetPath));
  return {
    title: extractMarkdownHeading(content) ?? fallbackTitle,
    targetPath,
    facts: extractMarkdownBulletSection(content, "## Durable Facts").filter(
      (item) => item !== "None curated yet.",
    ),
    evidence: extractMarkdownBulletSection(content, "## Supporting Evidence").filter(
      (item) => item !== "No supporting evidence captured yet.",
    ),
    sourceCandidates: extractMarkdownBulletSection(content, "## Source Candidates")
      .map(extractWikiLinkTarget)
      .filter((item) => item !== "None captured yet.")
      .filter(Boolean),
    relatedPaths: extractMarkdownBulletSection(content, "## Related")
      .map(extractWikiLinkTarget)
      .map(normalizeRelatedNotePath)
      .filter(Boolean),
  };
}

function buildMaintainedTopicContent(params: {
  title: string;
  generatedAt: string;
  facts: string[];
  evidence: string[];
  sourceCandidates: string[];
  relatedPaths: string[];
}): string {
  const frontmatter = renderFrontmatter([
    ["type", "steward-topic-note"],
    ["source", "openclaw-steward-maintain"],
    ["updated_at", params.generatedAt],
    ["aliases", [params.title]],
    ["curated_from", params.sourceCandidates],
    ["tags", ["steward/topic", "memory/curated"]],
  ]);
  const relatedPaths = dedupePreserveOrder(
    params.relatedPaths.length > 0 ? params.relatedPaths : [STEWARD_MEMORY_ROOT_FILE],
  );
  const lines = [
    frontmatter.trimEnd(),
    `# ${params.title}`,
    "",
    "Maintained by `openclaw steward maintain` to keep curated notes concise and linked.",
    "",
    "## Durable Facts",
    ...params.facts.map((fact) => `- ${fact}`),
    "",
    "## Supporting Evidence",
    ...params.evidence.map((item) => `- ${item}`),
    "",
    "## Source Candidates",
    ...params.sourceCandidates.map(
      (candidatePath) => `- [[${stripMarkdownExtension(candidatePath)}]]`,
    ),
    "",
    "## Related",
    ...relatedPaths.map((relatedPath) => `- [[${stripMarkdownExtension(relatedPath)}]]`),
    "",
  ];
  return toBudgetedMarkdown(lines.join("\n"), MAX_CURATED_TOPIC_BYTES);
}

function replaceMemoryIndexContent(params: {
  existingContent: string | null;
  links: Array<{ title: string; targetPath: string }>;
}): { content: string; updated: boolean } {
  const nextLinks = dedupePreserveOrder(
    params.links.map(
      (entry) =>
        `- [[${stripMarkdownExtension(entry.targetPath)}|${truncateText(entry.title, 72)}]]`,
    ),
  );
  const existingContent = params.existingContent ?? "# MEMORY\n";
  if (nextLinks.length === 0 && params.existingContent === null) {
    return { content: existingContent, updated: false };
  }
  const lines = existingContent.split(/\r?\n/u);
  const heading = "## Curated Topics";
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) {
    if (nextLinks.length === 0) {
      return { content: existingContent, updated: false };
    }
    const suffix = existingContent.trimEnd();
    const content = `${suffix}${suffix ? "\n\n" : ""}${heading}\n${nextLinks.join("\n")}\n`;
    return { content, updated: content !== existingContent };
  }

  const sectionStart = headingIndex + 1;
  let sectionEnd = lines.length;
  for (let index = sectionStart; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().startsWith("## ")) {
      sectionEnd = index;
      break;
    }
  }
  const rebuilt = [...lines.slice(0, sectionStart), ...nextLinks, ...lines.slice(sectionEnd)].join(
    "\n",
  );
  const content = rebuilt.endsWith("\n") ? rebuilt : `${rebuilt}\n`;
  return { content, updated: content !== existingContent };
}

function collectMalformedStewardCandidatePaths<T>(params: {
  workspaceDir: string;
  rootDir: string;
  parse: (args: { workspaceDir: string; absolutePath: string }) => T | null;
}): string[] {
  const badPaths: string[] = [];
  for (const absolutePath of listMarkdownFilesRecursive(params.rootDir)) {
    const relativePath = path.relative(params.workspaceDir, absolutePath).replace(/\\/g, "/");
    const content = fs.readFileSync(absolutePath, "utf-8");
    if (!content.trim()) {
      badPaths.push(relativePath);
      continue;
    }
    try {
      if (!params.parse({ workspaceDir: params.workspaceDir, absolutePath })) {
        badPaths.push(relativePath);
      }
    } catch {
      badPaths.push(relativePath);
    }
  }
  return badPaths.toSorted((left, right) => left.localeCompare(right));
}

function copyPathIfExists(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

async function captureStewardJsonResult<T>(
  run: (runtime: RuntimeEnv) => Promise<void>,
): Promise<T> {
  const logs: string[] = [];
  const runtime: RuntimeEnv = {
    log: (value: unknown) => logs.push(String(value)),
    error: (value: unknown) => {
      throw new Error(String(value));
    },
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
  };
  await run(runtime);
  const payload = logs.find(
    (entry) => entry.trim().startsWith("{") || entry.trim().startsWith("["),
  );
  if (!payload) {
    throw new Error("steward subcommand did not emit JSON");
  }
  return JSON.parse(payload) as T;
}

function sanitizeDryRunIngestResult(
  result: StewardIngestResult,
  workspaceDir: string,
): StewardIngestResult {
  return {
    ...result,
    mode: "dry-run",
    ledgerPaths: [],
    sessions: result.sessions.map((session) => ({
      ...session,
      workspaceDir,
    })),
  };
}

function sanitizeDryRunCurateResult(
  result: StewardCurateResult,
  workspaceDir: string,
): StewardCurateResult {
  return {
    ...result,
    mode: "dry-run",
    workspaceDir,
    ledgerPaths: [],
  };
}

function sanitizeDryRunMaintainResult(
  result: StewardMaintainResult,
  workspaceDir: string,
): StewardMaintainResult {
  return {
    ...result,
    mode: "dry-run",
    workspaceDir,
    ledgerPaths: [],
  };
}

function sanitizeDryRunIncubateSkillsResult(
  result: StewardIncubateSkillsResult,
  workspaceDir: string,
): StewardIncubateSkillsResult {
  return {
    ...result,
    mode: "dry-run",
    workspaceDir,
    ledgerPaths: [],
  };
}

function sanitizeDryRunPromoteSkillsResult(
  result: StewardPromoteSkillsResult,
  _workspaceDir: string,
): StewardPromoteSkillsResult {
  return {
    ...result,
    mode: "dry-run",
    ledgerPaths: [],
  };
}

function renderMaintainTextResult(result: StewardMaintainResult, runtime: RuntimeEnv): void {
  runtime.log(
    `Knowledge steward maintain (${result.mode}) - scanned ${result.scannedTopics}, split ${result.splitTopics}`,
  );
  runtime.log(`Evidence chunks written: ${result.evidenceChunksWritten}`);
  runtime.log(`Deleted malformed candidates: ${result.deletedPaths.length}`);
  runtime.log(`Memory index updated: ${result.memoryIndexUpdated ? "yes" : "no"}`);
  if (result.ledgerPaths.length > 0) {
    runtime.log(`Ledgers updated: ${result.ledgerPaths.length}`);
    for (const ledgerPath of result.ledgerPaths) {
      runtime.log(`- ${ledgerPath}`);
    }
  }
  if (result.deletedPaths.length > 0) {
    runtime.log("Deleted candidate paths:");
    for (const deletedPath of result.deletedPaths) {
      runtime.log(`- ${deletedPath}`);
    }
  }
  if (result.topics.length === 0) {
    runtime.log("No curated topic notes were found.");
    return;
  }
  runtime.log("Topic decisions:");
  for (const topic of result.topics) {
    const parts = [`- ${topic.action.toUpperCase()} ${topic.targetPath}`];
    if (topic.chunkPath) {
      parts.push(`chunk -> ${topic.chunkPath}`);
    }
    parts.push(`evidence moved: ${topic.evidenceMoved}`);
    runtime.log(parts.join(" | "));
  }
}

function renderIncubateSkillsTextResult(
  result: StewardIncubateSkillsResult,
  runtime: RuntimeEnv,
): void {
  runtime.log(
    `Knowledge steward incubate-skills (${result.mode}) - scanned ${result.scannedCandidates}, clusters ${result.incubators}, ready ${result.readyClusters}`,
  );
  if (result.ledgerPaths.length > 0) {
    runtime.log(`Ledgers updated: ${result.ledgerPaths.length}`);
    for (const ledgerPath of result.ledgerPaths) {
      runtime.log(`- ${ledgerPath}`);
    }
  }
  if (result.clusters.length === 0) {
    runtime.log("No reusable skill clusters were found.");
    return;
  }
  runtime.log("Cluster decisions:");
  for (const cluster of result.clusters) {
    runtime.log(
      `- ${cluster.action.toUpperCase()} ${cluster.slug} -> ${cluster.targetPath} | candidates ${cluster.candidateCount}, score ${cluster.score}, ready ${cluster.ready ? "yes" : "no"}`,
    );
  }
}

function renderPromoteSkillsTextResult(
  result: StewardPromoteSkillsResult,
  runtime: RuntimeEnv,
): void {
  runtime.log(
    `Knowledge steward promote-skills (${result.mode}) - scanned ${result.scannedIncubators}, created ${result.promotedSkills}, updated ${result.updatedSkills}, skipped ${result.skippedClusters}`,
  );
  if (result.ledgerPaths.length > 0) {
    runtime.log(`Ledgers updated: ${result.ledgerPaths.length}`);
    for (const ledgerPath of result.ledgerPaths) {
      runtime.log(`- ${ledgerPath}`);
    }
  }
  if (result.skills.length === 0) {
    runtime.log("No incubated skill clusters were found.");
    return;
  }
  runtime.log("Promotion decisions:");
  for (const skill of result.skills) {
    runtime.log(
      `- ${skill.action.toUpperCase()} ${skill.slug} -> ${skill.targetPath} | candidates ${skill.candidateCount}, score ${skill.score}`,
    );
  }
}

function renderCycleTextResult(result: StewardCycleResult, runtime: RuntimeEnv): void {
  runtime.log(`Knowledge steward cycle (${result.mode})`);
  if (result.workspaceDir) {
    runtime.log(`Workspace: ${result.workspaceDir}`);
  }
  if (result.ingest) {
    runtime.log(
      `Ingest: kept ${result.ingest.keptSessions}/${result.ingest.selectedSessions}, memory ${result.ingest.memoryCandidates}, skills ${result.ingest.skillCandidates}`,
    );
  }
  if (result.curate) {
    runtime.log(
      `Curate: created ${result.curate.createdNotes}, updated ${result.curate.updatedNotes}, index ${result.curate.memoryIndexUpdated ? "updated" : "unchanged"}`,
    );
  }
  if (result.maintain) {
    runtime.log(
      `Maintain: split ${result.maintain.splitTopics}, deleted ${result.maintain.deletedPaths.length}, index ${result.maintain.memoryIndexUpdated ? "updated" : "unchanged"}`,
    );
  }
  if (result.incubateSkills) {
    runtime.log(
      `Incubate skills: clusters ${result.incubateSkills.incubators}, ready ${result.incubateSkills.readyClusters}`,
    );
  }
  if (result.promoteSkills) {
    runtime.log(
      `Promote skills: created ${result.promoteSkills.promotedSkills}, updated ${result.promoteSkills.updatedSkills}, skipped ${result.promoteSkills.skippedClusters}`,
    );
  }
}

export async function stewardMaintainCommand(
  opts: StewardMaintainOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const now = new Date();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveStewardWorkspaceDir({
    cfg,
    agentId,
    workspace: opts.workspace,
  });
  const topicsRoot = path.join(workspaceDir, "memory", "topics");
  const topicFiles = listMarkdownFilesRecursive(topicsRoot).toSorted((left, right) =>
    left.localeCompare(right),
  );
  const parsedTopics = topicFiles
    .map((absolutePath) => parseStewardTopicNote({ workspaceDir, absolutePath }))
    .filter((topic): topic is ParsedStewardTopicNote => Boolean(topic));

  const topicWrites = new Map<string, string>();
  const evidenceChunkWrites = new Map<string, string>();
  const topicPlans: StewardMaintainTopicPlan[] = [];
  const memoryIndexLinks = new Map<string, { title: string; targetPath: string }>();

  for (const topic of parsedTopics) {
    memoryIndexLinks.set(topic.targetPath, { title: topic.title, targetPath: topic.targetPath });

    const absoluteTargetPath = resolveStewardAbsolutePath(workspaceDir, topic.targetPath, {
      allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
    });
    const existingContent = fs.readFileSync(absoluteTargetPath, "utf-8");
    const inlineEvidence = [...topic.evidence];
    const overflowEvidence: string[] = [];

    while (inlineEvidence.length > MAX_MAINTAIN_INLINE_EVIDENCE_ITEMS) {
      const moved = inlineEvidence.pop();
      if (!moved) {
        break;
      }
      overflowEvidence.unshift(moved);
    }

    let chunkPath =
      overflowEvidence.length > 0 ? buildTopicEvidenceChunkPath(topic.targetPath) : undefined;
    const buildNextContent = () =>
      buildMaintainedTopicContent({
        title: topic.title,
        generatedAt: now.toISOString(),
        facts: topic.facts,
        evidence: inlineEvidence,
        sourceCandidates: topic.sourceCandidates,
        relatedPaths: dedupePreserveOrder([
          STEWARD_MEMORY_ROOT_FILE,
          ...topic.relatedPaths.filter((relatedPath) => relatedPath !== STEWARD_MEMORY_ROOT_FILE),
          ...(chunkPath ? [chunkPath] : []),
        ]),
      });

    let nextContent = buildNextContent();
    while (
      Buffer.byteLength(nextContent, "utf-8") > MAX_CURATED_TOPIC_BYTES &&
      inlineEvidence.length > 1
    ) {
      const moved = inlineEvidence.pop();
      if (!moved) {
        break;
      }
      overflowEvidence.unshift(moved);
      if (!chunkPath) {
        chunkPath = buildTopicEvidenceChunkPath(topic.targetPath);
      }
      nextContent = buildNextContent();
    }

    if (overflowEvidence.length === 0) {
      topicPlans.push({
        targetPath: topic.targetPath,
        action: "skip",
        evidenceMoved: 0,
      });
      continue;
    }

    const ensuredChunkPath = chunkPath ?? buildTopicEvidenceChunkPath(topic.targetPath);
    const chunkContent = buildTopicEvidenceChunkContent({
      title: topic.title,
      parentPath: topic.targetPath,
      chunkPath: ensuredChunkPath,
      generatedAt: now.toISOString(),
      evidence: overflowEvidence,
    });
    topicWrites.set(topic.targetPath, nextContent);
    evidenceChunkWrites.set(ensuredChunkPath, chunkContent);
    topicPlans.push({
      targetPath: topic.targetPath,
      action: "split",
      evidenceMoved: overflowEvidence.length,
      chunkPath: ensuredChunkPath,
    });

    if (opts.apply === true && nextContent !== existingContent) {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: topic.targetPath,
        content: nextContent,
        allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
      });
    }
    if (opts.apply === true) {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: ensuredChunkPath,
        content: chunkContent,
        allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
      });
    }
  }

  const malformedPaths = dedupePreserveOrder([
    ...collectMalformedStewardCandidatePaths({
      workspaceDir,
      rootDir: path.join(workspaceDir, "memory", "inbox"),
      parse: parseStewardMemoryCandidate,
    }),
    ...collectMalformedStewardCandidatePaths({
      workspaceDir,
      rootDir: path.join(workspaceDir, "skills", "_candidates"),
      parse: parseStewardSkillCandidate,
    }),
  ]).toSorted((left, right) => left.localeCompare(right));

  const memoryIndexPath = STEWARD_MEMORY_ROOT_FILE;
  const absoluteMemoryIndexPath = resolveStewardAbsolutePath(workspaceDir, memoryIndexPath, {
    allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
    allowedExactPaths: [STEWARD_MEMORY_ROOT_FILE],
  });
  const existingMemoryIndex = fs.existsSync(absoluteMemoryIndexPath)
    ? fs.readFileSync(absoluteMemoryIndexPath, "utf-8")
    : null;
  const memoryIndexUpdate = replaceMemoryIndexContent({
    existingContent: existingMemoryIndex,
    links: Array.from(memoryIndexLinks.values()).toSorted((left, right) =>
      left.title.localeCompare(right.title),
    ),
  });

  if (opts.apply === true) {
    if (memoryIndexUpdate.updated) {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: memoryIndexPath,
        content: memoryIndexUpdate.content,
        allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
        allowedExactPaths: [STEWARD_MEMORY_ROOT_FILE],
      });
    }
    for (const relativePath of malformedPaths) {
      const absolutePath = resolveStewardAbsolutePath(workspaceDir, relativePath, {
        allowedPrefixes: STEWARD_MAINTAIN_ALLOWED_WRITE_PREFIXES,
      });
      if (fs.existsSync(absolutePath)) {
        fs.rmSync(absolutePath, { force: true });
      }
    }
  }

  const result: StewardMaintainResult = {
    runId: randomUUID(),
    mode: opts.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    workspaceDir,
    scannedTopics: parsedTopics.length,
    splitTopics: topicPlans.filter((topic) => topic.action === "split").length,
    evidenceChunksWritten: evidenceChunkWrites.size,
    deletedPaths: malformedPaths,
    memoryIndexUpdated: memoryIndexUpdate.updated,
    ledgerPaths: [],
    topics: topicPlans.toSorted((left, right) => left.targetPath.localeCompare(right.targetPath)),
  };

  if (opts.apply === true) {
    const ledgerPath = buildStewardLedgerPath(result.generatedAt);
    await appendStewardLedger({
      workspaceDir,
      ledgerPath,
      entry: {
        command: "maintain",
        runId: result.runId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        workspaceDir,
        scannedTopics: result.scannedTopics,
        splitTopics: result.splitTopics,
        evidenceChunksWritten: result.evidenceChunksWritten,
        deletedPaths: result.deletedPaths,
        memoryIndexUpdated: result.memoryIndexUpdated,
        chunkPaths: result.topics
          .filter((topic) => topic.action === "split" && topic.chunkPath)
          .map((topic) => topic.chunkPath),
      },
    });
    result.ledgerPaths.push(path.join(workspaceDir, ledgerPath));
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  renderMaintainTextResult(result, runtime);
}

export async function stewardIncubateSkillsCommand(
  opts: StewardIncubateSkillsOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const limit = parsePositiveIntOption(opts.limit, runtime, "--limit");
  if (limit === null) {
    return;
  }
  const now = new Date();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveStewardWorkspaceDir({
    cfg,
    agentId,
    workspace: opts.workspace,
  });
  const candidatesRoot = path.join(workspaceDir, "skills", "_candidates");
  const candidateFiles = listMarkdownFilesRecursive(candidatesRoot)
    .toSorted((left, right) => right.localeCompare(left))
    .slice(0, limit ?? DEFAULT_INCUBATE_LIMIT);
  const parsedCandidates = candidateFiles
    .map((absolutePath) => parseStewardSkillCandidate({ workspaceDir, absolutePath }))
    .filter((candidate): candidate is ParsedStewardSkillCandidate => Boolean(candidate));

  const candidateGroups = new Map<string, ParsedStewardSkillCandidate[]>();
  for (const candidate of parsedCandidates) {
    const slug = normalizeHyphenSlug(candidate.slug) || "steward-skill";
    const current = candidateGroups.get(slug) ?? [];
    current.push(candidate);
    candidateGroups.set(slug, current);
  }

  const clusterPlans: StewardSkillClusterPlan[] = [];

  for (const [slug, cluster] of candidateGroups) {
    const title = cluster[0]?.title ?? slug;
    const signals = dedupePreserveOrder(cluster.flatMap((candidate) => candidate.signals)).slice(
      0,
      MAX_AUTOMATION_SIGNALS,
    );
    const commands = dedupePreserveOrder(cluster.flatMap((candidate) => candidate.commands)).slice(
      0,
      MAX_COMMAND_SNIPPETS,
    );
    const tools = dedupePreserveOrder(cluster.flatMap((candidate) => candidate.tools)).slice(
      0,
      MAX_TOOL_NAMES,
    );
    const evidence = dedupePreserveOrder(cluster.flatMap((candidate) => candidate.evidence)).slice(
      0,
      MAX_EVIDENCE_ITEMS,
    );
    const score = computeSkillClusterScore({
      candidateCount: cluster.length,
      commands,
      tools,
      signals,
    });
    const targetPath = buildSkillIncubatorPath(slug);
    const absoluteTargetPath = resolveStewardAbsolutePath(workspaceDir, targetPath, {
      allowedPrefixes: STEWARD_INCUBATE_ALLOWED_WRITE_PREFIXES,
    });
    const nextContent = buildSkillIncubatorContent({
      title,
      slug,
      generatedAt: now.toISOString(),
      candidatePaths: cluster.map((candidate) => candidate.candidatePath),
      score,
      signals,
      commands,
      tools,
      evidence,
    });
    const existingContent = fs.existsSync(absoluteTargetPath)
      ? fs.readFileSync(absoluteTargetPath, "utf-8")
      : null;
    const action =
      existingContent === null ? "create" : existingContent === nextContent ? "skip" : "update";

    clusterPlans.push({
      slug,
      title,
      candidateCount: cluster.length,
      score,
      ready: cluster.length >= DEFAULT_PROMOTE_MIN_CANDIDATES,
      targetPath,
      action,
    });

    if (opts.apply === true && action !== "skip") {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: targetPath,
        content: nextContent,
        allowedPrefixes: STEWARD_INCUBATE_ALLOWED_WRITE_PREFIXES,
      });
    }
  }

  const result: StewardIncubateSkillsResult = {
    runId: randomUUID(),
    mode: opts.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    workspaceDir,
    scannedCandidates: candidateFiles.length,
    incubators: clusterPlans.length,
    readyClusters: clusterPlans.filter((cluster) => cluster.ready).length,
    ledgerPaths: [],
    clusters: clusterPlans.toSorted(
      (left, right) => right.score - left.score || left.slug.localeCompare(right.slug),
    ),
  };

  if (opts.apply === true) {
    const ledgerPath = buildStewardLedgerPath(result.generatedAt);
    await appendStewardLedger({
      workspaceDir,
      ledgerPath,
      entry: {
        command: "incubate-skills",
        runId: result.runId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        workspaceDir,
        scannedCandidates: result.scannedCandidates,
        incubators: result.incubators,
        readyClusters: result.readyClusters,
        targets: result.clusters
          .filter((cluster) => cluster.action !== "skip")
          .map((cluster) => cluster.targetPath),
      },
    });
    result.ledgerPaths.push(path.join(workspaceDir, ledgerPath));
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  renderIncubateSkillsTextResult(result, runtime);
}

export async function stewardPromoteSkillsCommand(
  opts: StewardPromoteSkillsOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const limit = parsePositiveIntOption(opts.limit, runtime, "--limit");
  if (limit === null) {
    return;
  }
  const minCandidates = parsePositiveIntOption(opts.minCandidates, runtime, "--min-candidates");
  if (minCandidates === null) {
    return;
  }
  const threshold = minCandidates ?? DEFAULT_PROMOTE_MIN_CANDIDATES;
  const now = new Date();
  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveStewardWorkspaceDir({
    cfg,
    agentId,
    workspace: opts.workspace,
  });
  const incubatorsRoot = path.join(workspaceDir, "skills", "_incubator");
  const incubatorFiles = listMarkdownFilesRecursive(incubatorsRoot)
    .toSorted((left, right) => right.localeCompare(left))
    .slice(0, limit ?? DEFAULT_PROMOTE_LIMIT);
  const parsedIncubators = incubatorFiles
    .map((absolutePath) => parseStewardSkillIncubator({ workspaceDir, absolutePath }))
    .filter((incubator): incubator is ParsedStewardSkillIncubator => Boolean(incubator));

  const skillPlans: StewardPromotedSkillPlan[] = [];

  for (const incubator of parsedIncubators) {
    const targetPath = buildPromotedSkillPath(incubator.slug);
    if (incubator.candidateCount < threshold) {
      skillPlans.push({
        slug: incubator.slug,
        title: incubator.title,
        candidateCount: incubator.candidateCount,
        score: incubator.score,
        sourcePath: incubator.incubatorPath,
        targetPath,
        action: "skip",
      });
      continue;
    }

    const absoluteTargetPath = resolveStewardAbsolutePath(workspaceDir, targetPath, {
      allowedPrefixes: STEWARD_PROMOTE_ALLOWED_WRITE_PREFIXES,
    });
    const nextContent = buildPromotedSkillContent({
      slug: incubator.slug,
      title: incubator.title,
      generatedAt: now.toISOString(),
      candidateCount: incubator.candidateCount,
      score: incubator.score,
      signals: incubator.signals,
      commands: incubator.commands,
      tools: incubator.tools,
      sourceCandidates: incubator.sourceCandidates,
    });
    const existingContent = fs.existsSync(absoluteTargetPath)
      ? fs.readFileSync(absoluteTargetPath, "utf-8")
      : null;
    const action =
      existingContent === null ? "create" : existingContent === nextContent ? "skip" : "update";

    skillPlans.push({
      slug: incubator.slug,
      title: incubator.title,
      candidateCount: incubator.candidateCount,
      score: incubator.score,
      sourcePath: incubator.incubatorPath,
      targetPath,
      action,
    });

    if (opts.apply === true && action !== "skip") {
      await writeStewardCandidateFile({
        workspaceDir,
        relativePath: targetPath,
        content: nextContent,
        allowedPrefixes: STEWARD_PROMOTE_ALLOWED_WRITE_PREFIXES,
      });
    }
  }

  const result: StewardPromoteSkillsResult = {
    runId: randomUUID(),
    mode: opts.apply === true ? "apply" : "dry-run",
    generatedAt: now.toISOString(),
    scannedIncubators: incubatorFiles.length,
    promotedSkills: skillPlans.filter((skill) => skill.action === "create").length,
    updatedSkills: skillPlans.filter((skill) => skill.action === "update").length,
    skippedClusters: skillPlans.filter((skill) => skill.action === "skip").length,
    ledgerPaths: [],
    skills: skillPlans.toSorted(
      (left, right) => right.score - left.score || left.slug.localeCompare(right.slug),
    ),
  };

  if (opts.apply === true) {
    const ledgerPath = buildStewardLedgerPath(result.generatedAt);
    await appendStewardLedger({
      workspaceDir,
      ledgerPath,
      entry: {
        command: "promote-skills",
        runId: result.runId,
        generatedAt: result.generatedAt,
        mode: result.mode,
        workspaceDir,
        scannedIncubators: result.scannedIncubators,
        promotedSkills: result.promotedSkills,
        updatedSkills: result.updatedSkills,
        skippedClusters: result.skippedClusters,
        targets: result.skills
          .filter((skill) => skill.action !== "skip")
          .map((skill) => skill.targetPath),
      },
    });
    result.ledgerPaths.push(path.join(workspaceDir, ledgerPath));
  }

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  renderPromoteSkillsTextResult(result, runtime);
}

export async function stewardCycleCommand(
  opts: StewardCycleOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  if (opts.allAgents === true && !opts.workspace?.trim()) {
    runtime.error("--workspace is required when using --all-agents with steward cycle");
    runtime.exit(1);
    return;
  }

  const agentId = opts.agent?.trim() || resolveDefaultAgentId(cfg);
  const workspaceDir = resolveStewardWorkspaceDir({
    cfg,
    agentId,
    workspace: opts.workspace,
  });

  let previewRoot: string | null = null;
  let runWorkspaceDir = workspaceDir;
  if (opts.apply !== true) {
    previewRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-cycle-"));
    runWorkspaceDir = path.join(previewRoot, "workspace");
    fs.mkdirSync(runWorkspaceDir, { recursive: true });
    copyPathIfExists(
      path.join(workspaceDir, STEWARD_MEMORY_ROOT_FILE),
      path.join(runWorkspaceDir, STEWARD_MEMORY_ROOT_FILE),
    );
    copyPathIfExists(path.join(workspaceDir, "memory"), path.join(runWorkspaceDir, "memory"));
    copyPathIfExists(path.join(workspaceDir, "skills"), path.join(runWorkspaceDir, "skills"));
  }

  try {
    const ingestRaw = await captureStewardJsonResult<StewardIngestResult>((captureRuntime) =>
      stewardIngestCommand(
        {
          store: opts.store,
          workspace: runWorkspaceDir,
          agent: opts.agent,
          allAgents: opts.allAgents,
          active: opts.active,
          recent: opts.recent,
          apply: true,
          json: true,
        },
        captureRuntime,
      ),
    );
    const curateRaw = await captureStewardJsonResult<StewardCurateResult>((captureRuntime) =>
      stewardCurateCommand(
        {
          workspace: runWorkspaceDir,
          agent: opts.agent,
          limit: opts.curateLimit,
          apply: true,
          json: true,
        },
        captureRuntime,
      ),
    );
    const maintainRaw = await captureStewardJsonResult<StewardMaintainResult>((captureRuntime) =>
      stewardMaintainCommand(
        {
          workspace: runWorkspaceDir,
          agent: opts.agent,
          apply: true,
          json: true,
        },
        captureRuntime,
      ),
    );
    const incubateRaw = await captureStewardJsonResult<StewardIncubateSkillsResult>(
      (captureRuntime) =>
        stewardIncubateSkillsCommand(
          {
            workspace: runWorkspaceDir,
            agent: opts.agent,
            limit: opts.incubateLimit,
            apply: true,
            json: true,
          },
          captureRuntime,
        ),
    );
    const promoteRaw = await captureStewardJsonResult<StewardPromoteSkillsResult>(
      (captureRuntime) =>
        stewardPromoteSkillsCommand(
          {
            workspace: runWorkspaceDir,
            agent: opts.agent,
            limit: opts.promoteLimit,
            minCandidates: opts.minCandidates,
            apply: true,
            json: true,
          },
          captureRuntime,
        ),
    );

    const result: StewardCycleResult = {
      runId: randomUUID(),
      mode: opts.apply === true ? "apply" : "dry-run",
      generatedAt: new Date().toISOString(),
      workspaceDir,
      ingest: opts.apply === true ? ingestRaw : sanitizeDryRunIngestResult(ingestRaw, workspaceDir),
      curate: opts.apply === true ? curateRaw : sanitizeDryRunCurateResult(curateRaw, workspaceDir),
      maintain:
        opts.apply === true ? maintainRaw : sanitizeDryRunMaintainResult(maintainRaw, workspaceDir),
      incubateSkills:
        opts.apply === true
          ? incubateRaw
          : sanitizeDryRunIncubateSkillsResult(incubateRaw, workspaceDir),
      promoteSkills:
        opts.apply === true
          ? promoteRaw
          : sanitizeDryRunPromoteSkillsResult(promoteRaw, workspaceDir),
    };

    if (opts.json) {
      writeRuntimeJson(runtime, result);
      return;
    }
    renderCycleTextResult(result, runtime);
  } finally {
    if (previewRoot) {
      fs.rmSync(previewRoot, { recursive: true, force: true });
    }
  }
}
