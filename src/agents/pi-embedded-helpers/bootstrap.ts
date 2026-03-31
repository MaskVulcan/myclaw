import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../../config/config.js";
import { truncateUtf16Safe } from "../../utils.js";
import { DEFAULT_AGENTS_FILENAME, type WorkspaceBootstrapFile } from "../workspace.js";
import type { EmbeddedContextFile } from "./types.js";

type ContentBlockWithSignature = {
  thought_signature?: unknown;
  thoughtSignature?: unknown;
  [key: string]: unknown;
};

type ThoughtSignatureSanitizeOptions = {
  allowBase64Only?: boolean;
  includeCamelCase?: boolean;
};

function isBase64Signature(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    return false;
  }
  const isUrl = compact.includes("-") || compact.includes("_");
  try {
    const buf = Buffer.from(compact, isUrl ? "base64url" : "base64");
    if (buf.length === 0) {
      return false;
    }
    const encoded = buf.toString(isUrl ? "base64url" : "base64");
    const normalize = (input: string) => input.replace(/=+$/g, "");
    return normalize(encoded) === normalize(compact);
  } catch {
    return false;
  }
}

/**
 * Strips Claude-style thought_signature fields from content blocks.
 *
 * Gemini expects thought signatures as base64-encoded bytes, but Claude stores message ids
 * like "msg_abc123...". We only strip "msg_*" to preserve any provider-valid signatures.
 */
export function stripThoughtSignatures<T>(
  content: T,
  options?: ThoughtSignatureSanitizeOptions,
): T {
  if (!Array.isArray(content)) {
    return content;
  }
  const allowBase64Only = options?.allowBase64Only ?? false;
  const includeCamelCase = options?.includeCamelCase ?? false;
  const shouldStripSignature = (value: unknown): boolean => {
    if (!allowBase64Only) {
      return typeof value === "string" && value.startsWith("msg_");
    }
    return typeof value !== "string" || !isBase64Signature(value);
  };
  return content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const rec = block as ContentBlockWithSignature;
    const stripSnake = shouldStripSignature(rec.thought_signature);
    const stripCamel = includeCamelCase ? shouldStripSignature(rec.thoughtSignature) : false;
    if (!stripSnake && !stripCamel) {
      return block;
    }
    const next = { ...rec };
    if (stripSnake) {
      delete next.thought_signature;
    }
    if (stripCamel) {
      delete next.thoughtSignature;
    }
    return next;
  }) as T;
}

export const DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000;
export const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;
export const DEFAULT_BOOTSTRAP_PROMPT_TRUNCATION_WARNING_MODE = "once";
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;
const AGENTS_COMPACT_LINE_MAX_CHARS = 160;
const AGENTS_MARKDOWN_COMPACTION_PASSES = [
  { maxSections: 24, maxBodyLinesPerSection: 5, lineMaxChars: AGENTS_COMPACT_LINE_MAX_CHARS },
  { maxSections: 18, maxBodyLinesPerSection: 3, lineMaxChars: 120 },
  { maxSections: 12, maxBodyLinesPerSection: 2, lineMaxChars: 96 },
] as const;

type MarkdownSection = {
  heading?: string;
  lines: string[];
};

type TrimBootstrapResult = {
  content: string;
  truncated: boolean;
  maxChars: number;
  originalLength: number;
};

export function resolveBootstrapMaxChars(cfg?: OpenClawConfig): number {
  const raw = cfg?.agents?.defaults?.bootstrapMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_MAX_CHARS;
}

export function resolveBootstrapTotalMaxChars(cfg?: OpenClawConfig): number {
  const raw = cfg?.agents?.defaults?.bootstrapTotalMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;
}

export function resolveBootstrapPromptTruncationWarningMode(
  cfg?: OpenClawConfig,
): "off" | "once" | "always" {
  const raw = cfg?.agents?.defaults?.bootstrapPromptTruncationWarning;
  if (raw === "off" || raw === "once" || raw === "always") {
    return raw;
  }
  return DEFAULT_BOOTSTRAP_PROMPT_TRUNCATION_WARNING_MODE;
}

function trimBootstrapContent(
  content: string,
  fileName: string,
  maxChars: number,
): TrimBootstrapResult {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return {
      content: trimmed,
      truncated: false,
      maxChars,
      originalLength: trimmed.length,
    };
  }

  const compactedMarkdown = compactAgentsBootstrapContent(trimmed, fileName, maxChars);
  if (compactedMarkdown) {
    return {
      content: compactedMarkdown,
      truncated: true,
      maxChars,
      originalLength: trimmed.length,
    };
  }

  const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
  const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);

  const marker = [
    "",
    `[...truncated, read ${fileName} for full content...]`,
    `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`,
    "",
  ].join("\n");
  const contentWithMarker = [head, marker, tail].join("\n");
  return {
    content: contentWithMarker,
    truncated: true,
    maxChars,
    originalLength: trimmed.length,
  };
}

function compactLine(line: string, maxChars: number): string {
  const normalized = line.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return truncateUtf16Safe(normalized, Math.max(0, maxChars));
  }
  return `${truncateUtf16Safe(normalized, maxChars - 1)}...`;
}

function compactParagraph(line: string, maxChars: number): string {
  const normalized = line.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const firstSentence = normalized.split(/(?<=[.!?])\s+/u)[0] ?? normalized;
  if (firstSentence.length <= maxChars) {
    return firstSentence;
  }
  return compactLine(firstSentence, maxChars);
}

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function isCompactRuleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/^>\s+/.test(trimmed)) {
    return true;
  }
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
    return true;
  }
  if (/^`[^`]+`/.test(trimmed)) {
    return true;
  }
  return trimmed.endsWith(":") && trimmed.length <= 100;
}

function splitMarkdownSections(content: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = content.split(/\r?\n/u);
  let current: MarkdownSection = { lines: [] };
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,6}\s+/.test(trimmed)) {
      if (current.heading || current.lines.length > 0) {
        sections.push(current);
      }
      current = { heading: trimmed, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.heading || current.lines.length > 0) {
    sections.push(current);
  }
  return sections;
}

function buildCompactMarkdownSection(
  section: MarkdownSection,
  opts: { maxBodyLinesPerSection: number; lineMaxChars: number },
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  if (section.heading) {
    const heading = compactLine(section.heading, opts.lineMaxChars);
    result.push(heading);
    seen.add(heading);
  }

  let keptParagraph = false;
  let inFence = false;
  for (const rawLine of section.lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    let candidate = "";
    if (isBulletLine(rawLine) || isCompactRuleLine(rawLine)) {
      candidate = compactLine(trimmed, opts.lineMaxChars);
    } else if (!keptParagraph) {
      candidate = compactParagraph(trimmed, opts.lineMaxChars);
      keptParagraph = true;
    } else {
      continue;
    }

    if (!candidate || seen.has(candidate)) {
      continue;
    }
    result.push(candidate);
    seen.add(candidate);
    const bodyLines = section.heading ? result.length - 1 : result.length;
    if (bodyLines >= opts.maxBodyLinesPerSection) {
      break;
    }
  }

  return result;
}

function buildCompactedMarkdown(
  sections: MarkdownSection[],
  opts: { maxSections: number; maxBodyLinesPerSection: number; lineMaxChars: number },
): string {
  const header = [
    `[Compacted summary of ${DEFAULT_AGENTS_FILENAME}; read the file directly if exact wording matters.]`,
    "",
  ];
  const sectionBlocks: string[] = [];
  for (const section of sections.slice(0, opts.maxSections)) {
    const lines = buildCompactMarkdownSection(section, opts);
    if (lines.length === 0) {
      continue;
    }
    sectionBlocks.push(lines.join("\n"));
  }
  return [...header, ...sectionBlocks].join("\n\n").trimEnd();
}

function compactAgentsBootstrapContent(
  content: string,
  fileName: string,
  maxChars: number,
): string | undefined {
  if (fileName !== DEFAULT_AGENTS_FILENAME) {
    return undefined;
  }
  const sections = splitMarkdownSections(content);
  if (sections.length === 0) {
    return undefined;
  }
  for (const pass of AGENTS_MARKDOWN_COMPACTION_PASSES) {
    const compacted = buildCompactedMarkdown(sections, pass);
    if (compacted.length > 0 && compacted.length <= maxChars && compacted.length < content.length) {
      return compacted;
    }
  }
  return undefined;
}

function clampToBudget(content: string, budget: number): string {
  if (budget <= 0) {
    return "";
  }
  if (content.length <= budget) {
    return content;
  }
  if (budget <= 3) {
    return truncateUtf16Safe(content, budget);
  }
  const safe = budget - 1;
  return `${truncateUtf16Safe(content, safe)}…`;
}

export async function ensureSessionHeader(params: {
  sessionFile: string;
  sessionId: string;
  cwd: string;
}) {
  const file = params.sessionFile;
  try {
    await fs.stat(file);
    return;
  } catch {
    // create
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const sessionVersion = 2;
  const entry = {
    type: "session",
    version: sessionVersion,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: params.cwd,
  };
  await fs.writeFile(file, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function buildBootstrapContextFiles(
  files: WorkspaceBootstrapFile[],
  opts?: { warn?: (message: string) => void; maxChars?: number; totalMaxChars?: number },
): EmbeddedContextFile[] {
  const maxChars = opts?.maxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const totalMaxChars = Math.max(
    1,
    Math.floor(opts?.totalMaxChars ?? Math.max(maxChars, DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS)),
  );
  let remainingTotalChars = totalMaxChars;
  const result: EmbeddedContextFile[] = [];
  for (const file of files) {
    if (remainingTotalChars <= 0) {
      break;
    }
    const pathValue = typeof file.path === "string" ? file.path.trim() : "";
    if (!pathValue) {
      opts?.warn?.(
        `skipping bootstrap file "${file.name}" — missing or invalid "path" field (hook may have used "filePath" instead)`,
      );
      continue;
    }
    if (file.missing) {
      const missingText = `[MISSING] Expected at: ${pathValue}`;
      const cappedMissingText = clampToBudget(missingText, remainingTotalChars);
      if (!cappedMissingText) {
        break;
      }
      remainingTotalChars = Math.max(0, remainingTotalChars - cappedMissingText.length);
      result.push({
        path: pathValue,
        content: cappedMissingText,
      });
      continue;
    }
    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      opts?.warn?.(
        `remaining bootstrap budget is ${remainingTotalChars} chars (<${MIN_BOOTSTRAP_FILE_BUDGET_CHARS}); skipping additional bootstrap files`,
      );
      break;
    }
    const fileMaxChars = Math.max(1, Math.min(maxChars, remainingTotalChars));
    const trimmed = trimBootstrapContent(file.content ?? "", file.name, fileMaxChars);
    const contentWithinBudget = clampToBudget(trimmed.content, remainingTotalChars);
    if (!contentWithinBudget) {
      continue;
    }
    if (trimmed.truncated || contentWithinBudget.length < trimmed.content.length) {
      opts?.warn?.(
        `workspace bootstrap file ${file.name} is ${trimmed.originalLength} chars (limit ${trimmed.maxChars}); truncating in injected context`,
      );
    }
    remainingTotalChars = Math.max(0, remainingTotalChars - contentWithinBudget.length);
    result.push({
      path: pathValue,
      content: contentWithinBudget,
    });
  }
  return result;
}

export function sanitizeGoogleTurnOrdering(messages: AgentMessage[]): AgentMessage[] {
  const GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT = "(session bootstrap)";
  const first = messages[0] as { role?: unknown; content?: unknown } | undefined;
  const role = first?.role;
  const content = first?.content;
  if (
    role === "user" &&
    typeof content === "string" &&
    content.trim() === GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT
  ) {
    return messages;
  }
  if (role !== "assistant") {
    return messages;
  }

  // Cloud Code Assist rejects histories that begin with a model turn (tool call or text).
  // Prepend a tiny synthetic user turn so the rest of the transcript can be used.
  const bootstrap: AgentMessage = {
    role: "user",
    content: GOOGLE_TURN_ORDER_BOOTSTRAP_TEXT,
    timestamp: Date.now(),
  } as AgentMessage;

  return [bootstrap, ...messages];
}
