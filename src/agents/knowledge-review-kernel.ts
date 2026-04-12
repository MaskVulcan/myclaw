import fs from "node:fs";
import path from "node:path";
import type { SessionEntry } from "../config/sessions.js";
import {
  readSessionMessages,
  readSessionPreviewItemsFromTranscript,
  readSessionTitleFieldsFromTranscript,
} from "../gateway/session-utils.js";
import type { SessionPreviewItem } from "../gateway/session-utils.types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { stripEnvelope } from "../shared/chat-envelope.js";
import { normalizeHyphenSlug } from "../shared/string-normalization.js";
import { extractToolCallNames } from "../utils/transcript-tools.js";
import {
  clearKnowledgeReviewNudge,
  loadKnowledgeReviewNudge,
  type KnowledgeReviewNudge,
  type KnowledgeReviewRecord,
  type KnowledgeReviewUserModelSignals,
  writeKnowledgeReviewNudge,
  writeKnowledgeReviewRecord,
} from "./knowledge-review-store.js";
import {
  resolveDefaultMemoryProviderKernel,
  type MemoryStewardSessionEndResult,
} from "./memory-provider-kernel.js";
import { buildWorkflowFingerprint } from "./workflow-fingerprint.js";

const log = createSubsystemLogger("agents/knowledge-review-kernel");

type NormalizedReviewMessage = {
  role: string;
  text: string;
  toolNames: string[];
};

export type KnowledgeReviewNudgeParams = {
  workspaceDir: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  transcriptFile?: string;
  reason: string;
};

export type KnowledgeReviewSessionParams = {
  workspaceDir: string;
  agentId: string;
  sessionKey: string;
  entry: SessionEntry;
};

export type KnowledgeReviewSessionResult = {
  recordPath: string;
  record: KnowledgeReviewRecord;
};

export type KnowledgeReviewSessionEndResult = KnowledgeReviewSessionResult & {
  steward: MemoryStewardSessionEndResult;
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function toTitleCandidate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const line = value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find(Boolean);
  return line ? truncate(line, 80) : undefined;
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.content === "string") {
    return stripEnvelope(entry.content).trim();
  }
  if (typeof entry.text === "string") {
    return stripEnvelope(entry.text).trim();
  }
  if (Array.isArray(entry.content)) {
    return entry.content
      .flatMap((block) => {
        if (!block || typeof block !== "object") {
          return [];
        }
        const text =
          typeof (block as Record<string, unknown>).text === "string"
            ? String((block as Record<string, unknown>).text)
            : "";
        return text ? [stripEnvelope(text).trim()] : [];
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function normalizeMessages(messages: unknown[]): NormalizedReviewMessage[] {
  const normalized: NormalizedReviewMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role : "";
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractMessageText(entry);
    const toolNames = extractToolCallNames(entry);
    if (!text && toolNames.length === 0) {
      continue;
    }
    normalized.push({
      role,
      text,
      toolNames,
    });
  }
  return normalized;
}

function splitSignalFragments(text: string): string[] {
  return text
    .split(/\r?\n|[•;]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => truncate(item, 180));
}

function maybeExtractName(text: string): string | undefined {
  const patterns = [
    /\bmy name is\s+([A-Z][A-Za-z0-9._' -]{0,40})/i,
    /\bcall me\s+([A-Z][A-Za-z0-9._' -]{0,40})/i,
    /我叫([^\s，。,.]{1,20})/u,
    /叫我([^\s，。,.]{1,20})/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function maybeExtractPreferredAddress(text: string): string | undefined {
  const patterns = [
    /\bcall me\s+([A-Za-z0-9._' -]{1,40})/i,
    /\baddress me as\s+([A-Za-z0-9._' -]{1,40})/i,
    /叫我([^\s，。,.]{1,20})/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function maybeExtractPronouns(text: string): string | undefined {
  const match = text.match(/\b(?:my pronouns are|pronouns)\s*[:=-]?\s*([A-Za-z/ -]{2,30})/i);
  return match?.[1]?.trim();
}

function maybeExtractTimezone(text: string): string | undefined {
  const patterns = [
    /\b(?:timezone|time zone|tz)\s*[:=-]?\s*([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/i,
    /\b(?:timezone|time zone|tz)\s*[:=-]?\s*((?:UTC|GMT)[+-]\d{1,2}(?::\d{2})?)/i,
    /\b(?:timezone|time zone|tz)\s*[:=-]?\s*((?:PST|PDT|EST|EDT|CST|CDT|MST|MDT|GMT|UTC|CET|CEST|JST|KST|HKT|SGT))\b/i,
    /时区[：: ]*([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/u,
    /时区[：: ]*((?:UTC|GMT)[+-]\d{1,2}(?::\d{2})?)/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function collectUserModelSignals(
  messages: NormalizedReviewMessage[],
): KnowledgeReviewUserModelSignals {
  const preferences: string[] = [];
  const contexts: string[] = [];
  const goals: string[] = [];
  const notes: string[] = [];
  let name: string | undefined;
  let preferredAddress: string | undefined;
  let pronouns: string | undefined;
  let timezone: string | undefined;

  for (const message of messages) {
    if (message.role !== "user" || !message.text) {
      continue;
    }
    const fragments = splitSignalFragments(message.text);
    for (const fragment of fragments) {
      name ??= maybeExtractName(fragment);
      preferredAddress ??= maybeExtractPreferredAddress(fragment);
      pronouns ??= maybeExtractPronouns(fragment);
      timezone ??= maybeExtractTimezone(fragment);

      if (
        /\b(prefer|preference|default to|please|avoid|keep|use|don't|do not)\b/i.test(fragment) ||
        /偏好|默认|请用|尽量|不要/u.test(fragment)
      ) {
        preferences.push(fragment);
      }
      if (
        /\b(working on|project|building|focused on|currently|customer|workspace)\b/i.test(
          fragment,
        ) ||
        /正在做|在做|项目|客户|当前/u.test(fragment)
      ) {
        contexts.push(fragment);
      }
      if (
        /\b(need to|want to|trying to|goal|plan to|roadmap)\b/i.test(fragment) ||
        /目标|计划|要做|想要/u.test(fragment)
      ) {
        goals.push(fragment);
      }
      if (
        /\b(remember|important|note that|ongoing)\b/i.test(fragment) ||
        /记住|重要|长期/u.test(fragment)
      ) {
        notes.push(fragment);
      }
    }
  }

  return {
    ...(name ? { name } : {}),
    ...(preferredAddress ? { preferredAddress } : {}),
    ...(pronouns ? { pronouns } : {}),
    ...(timezone ? { timezone } : {}),
    preferences: unique(preferences).slice(0, 8),
    contexts: unique(contexts).slice(0, 8),
    goals: unique(goals).slice(0, 8),
    notes: unique(notes).slice(0, 8),
  };
}

function collectCommandSnippets(text: string): string[] {
  const commands: string[] = [];
  const pushIfCommand = (candidate: string) => {
    const trimmed = candidate.trim().replace(/^\$\s*/, "");
    if (
      /^(openclaw|git|pnpm|npm|yarn|bun|node|python|uv|cargo|docker|kubectl|helm|make|bash|sh)\b/i.test(
        trimmed,
      )
    ) {
      commands.push(truncate(trimmed, 160));
    }
  };

  for (const match of text.matchAll(/`([^`\n]{2,220})`/g)) {
    pushIfCommand(match[1] ?? "");
  }
  for (const line of text.split(/\r?\n/)) {
    pushIfCommand(line);
  }
  return unique(commands).slice(0, 10);
}

function collectAutomationSignals(messages: NormalizedReviewMessage[]) {
  const commands: string[] = [];
  const tools: string[] = [];
  for (const message of messages) {
    commands.push(...collectCommandSnippets(message.text));
    tools.push(...message.toolNames);
  }
  const uniqueCommands = unique(commands).slice(0, 12);
  const uniqueTools = unique(tools).slice(0, 12);
  const suggestedTitle = uniqueCommands[0]
    ? truncate(uniqueCommands[0].replace(/\s+--json\b/gi, "").replace(/\s+/g, " "), 60)
    : undefined;
  const suggestedSlug = suggestedTitle
    ? normalizeHyphenSlug(
        suggestedTitle
          .replace(/^(openclaw|git|pnpm|npm|yarn|bun|node|python|uv|cargo|docker)\s+/i, "")
          .replace(/\s+/g, "-"),
      ) || undefined
    : undefined;
  const workflowFingerprint = buildWorkflowFingerprint({
    commands: uniqueCommands,
    tools: uniqueTools,
    suggestedSlug,
  });
  return {
    commands: uniqueCommands,
    tools: uniqueTools,
    ...(suggestedTitle ? { suggestedTitle } : {}),
    ...(suggestedSlug ? { suggestedSlug } : {}),
    ...(workflowFingerprint ? { workflowFingerprint } : {}),
  };
}

function previewTexts(items: SessionPreviewItem[]): string[] {
  return unique(
    items
      .map((item) => item.text)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => truncate(value, 140)),
  ).slice(0, 6);
}

function previewTextsFromMessages(messages: NormalizedReviewMessage[]): string[] {
  return unique(
    [...messages]
      .toReversed()
      .map((message) => message.text)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => truncate(value, 140)),
  )
    .slice(0, 6)
    .toReversed();
}

function buildTags(params: {
  title: string;
  userModel: KnowledgeReviewUserModelSignals;
  automation: ReturnType<typeof collectAutomationSignals>;
}): string[] {
  const tags = [
    params.title,
    ...params.userModel.preferences,
    ...params.userModel.contexts,
    ...params.userModel.goals,
    ...params.automation.tools,
  ]
    .flatMap((value) =>
      value
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .filter((part) => part.length >= 2),
    )
    .slice(0, 64);
  return unique(tags).slice(0, 12);
}

function buildSummary(params: {
  title: string;
  firstUserMessage?: string;
  lastMessagePreview?: string;
  userModel: KnowledgeReviewUserModelSignals;
  automation: ReturnType<typeof collectAutomationSignals>;
  previewItems: string[];
}): string {
  const fragments = [
    truncate(params.title, 80),
    params.userModel.preferences[0],
    params.userModel.contexts[0],
    params.userModel.goals[0],
    params.automation.commands[0],
    params.lastMessagePreview,
    params.firstUserMessage,
    params.previewItems[0],
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => truncate(value, 140));
  return unique(fragments).slice(0, 4).join(" | ");
}

function buildReviewRecord(params: {
  sessionId: string;
  sessionKey: string;
  agentId: string;
  transcriptFile?: string;
  firstUserMessage?: string;
  lastMessagePreview?: string;
  title: string;
  previewItems: string[];
  messages: NormalizedReviewMessage[];
}): KnowledgeReviewRecord {
  const userModel = collectUserModelSignals(params.messages);
  const automation = collectAutomationSignals(params.messages);
  const tags = buildTags({
    title: params.title,
    userModel,
    automation,
  });
  const summary = buildSummary({
    title: params.title,
    firstUserMessage: params.firstUserMessage,
    lastMessagePreview: params.lastMessagePreview,
    userModel,
    automation,
    previewItems: params.previewItems,
  });

  return {
    schemaVersion: 1,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    ...(params.transcriptFile ? { transcriptFile: params.transcriptFile } : {}),
    reviewedAt: new Date().toISOString(),
    title: truncate(params.title || params.sessionId, 80),
    ...(params.firstUserMessage
      ? { firstUserMessage: truncate(params.firstUserMessage, 240) }
      : {}),
    ...(params.lastMessagePreview
      ? { lastMessagePreview: truncate(params.lastMessagePreview, 240) }
      : {}),
    summary,
    tags,
    previewItems: params.previewItems,
    messageCount: params.messages.length,
    userMessageCount: params.messages.filter((message) => message.role === "user").length,
    assistantMessageCount: params.messages.filter((message) => message.role === "assistant").length,
    userModel,
    automation,
  };
}

async function enqueueKnowledgeReviewNudge(
  params: KnowledgeReviewNudgeParams,
): Promise<{ nudgePath: string; nudge: KnowledgeReviewNudge }> {
  const existing = await loadKnowledgeReviewNudge(params.workspaceDir, params.sessionId);
  const now = new Date().toISOString();
  const nudge: KnowledgeReviewNudge = {
    schemaVersion: 1,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    ...(params.transcriptFile ? { transcriptFile: params.transcriptFile } : {}),
    firstNudgedAt: existing?.firstNudgedAt ?? now,
    updatedAt: now,
    reasons: unique([...(existing?.reasons ?? []), params.reason]),
  };
  const nudgePath = await writeKnowledgeReviewNudge({
    workspaceDir: params.workspaceDir,
    nudge,
  });
  return { nudgePath, nudge };
}

async function reviewKnowledgeSession(
  params: KnowledgeReviewSessionParams,
): Promise<KnowledgeReviewSessionResult | null> {
  const transcriptFile =
    typeof params.entry.sessionFile === "string" && params.entry.sessionFile.trim().length > 0
      ? params.entry.sessionFile.trim()
      : undefined;
  const transcriptExists = transcriptFile ? fs.existsSync(transcriptFile) : false;
  const messages = normalizeMessages(
    readSessionMessages(
      params.entry.sessionId,
      undefined,
      transcriptExists ? transcriptFile : undefined,
    ),
  );
  if (messages.length === 0) {
    return null;
  }
  const derivedFirstUserMessage = messages.find(
    (message) => message.role === "user" && message.text,
  )?.text;
  const derivedLastMessagePreview = [...messages]
    .toReversed()
    .find((message) => message.text)?.text;

  const titleFields = readSessionTitleFieldsFromTranscript(
    params.entry.sessionId,
    undefined,
    transcriptExists ? transcriptFile : undefined,
    params.agentId,
  );
  const transcriptPreviews = previewTexts(
    readSessionPreviewItemsFromTranscript(
      params.entry.sessionId,
      undefined,
      transcriptExists ? transcriptFile : undefined,
      params.agentId,
      6,
      160,
    ),
  );
  const previews =
    transcriptPreviews.length > 0 ? transcriptPreviews : previewTextsFromMessages(messages);
  const title =
    toTitleCandidate(titleFields.firstUserMessage) ||
    toTitleCandidate(derivedFirstUserMessage) ||
    toTitleCandidate(titleFields.lastMessagePreview) ||
    toTitleCandidate(derivedLastMessagePreview) ||
    path.basename(transcriptFile ?? params.entry.sessionId);
  const record = buildReviewRecord({
    sessionId: params.entry.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    ...(transcriptExists && transcriptFile ? { transcriptFile } : {}),
    ...(titleFields.firstUserMessage || derivedFirstUserMessage
      ? { firstUserMessage: titleFields.firstUserMessage ?? derivedFirstUserMessage }
      : {}),
    ...(titleFields.lastMessagePreview || derivedLastMessagePreview
      ? { lastMessagePreview: titleFields.lastMessagePreview ?? derivedLastMessagePreview }
      : {}),
    title,
    previewItems: previews,
    messages,
  });
  const recordPath = await writeKnowledgeReviewRecord({
    workspaceDir: params.workspaceDir,
    record,
  });
  await clearKnowledgeReviewNudge(params.workspaceDir, params.entry.sessionId);
  return { recordPath, record };
}

export type KnowledgeReviewKernel = {
  nudgeSession: (
    params: KnowledgeReviewNudgeParams,
  ) => Promise<{ nudgePath: string; nudge: KnowledgeReviewNudge }>;
  reviewSession: (
    params: KnowledgeReviewSessionParams,
  ) => Promise<KnowledgeReviewSessionResult | null>;
  runSessionEndCycle: (
    params: KnowledgeReviewSessionParams & {
      curateLimit?: string;
      incubateLimit?: string;
      promoteLimit?: string;
      minCandidates?: string;
    },
  ) => Promise<KnowledgeReviewSessionEndResult | null>;
};

const defaultKnowledgeReviewKernel: KnowledgeReviewKernel = {
  nudgeSession: async (params) => await enqueueKnowledgeReviewNudge(params),
  reviewSession: async (params) => await reviewKnowledgeSession(params),
  runSessionEndCycle: async (params) => {
    const review = await reviewKnowledgeSession(params);
    if (!review) {
      return null;
    }
    const steward = await resolveDefaultMemoryProviderKernel().runSessionStewardCycle({
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      entry: params.entry,
      ...(params.curateLimit ? { curateLimit: params.curateLimit } : {}),
      ...(params.incubateLimit ? { incubateLimit: params.incubateLimit } : {}),
      ...(params.promoteLimit ? { promoteLimit: params.promoteLimit } : {}),
      ...(params.minCandidates ? { minCandidates: params.minCandidates } : {}),
    });
    return {
      ...review,
      steward,
    };
  },
};

export function resolveDefaultKnowledgeReviewKernel(): KnowledgeReviewKernel {
  return defaultKnowledgeReviewKernel;
}

export async function reviewSessionWithKnowledgeKernel(
  params: KnowledgeReviewSessionParams,
): Promise<KnowledgeReviewSessionResult | null> {
  try {
    return await resolveDefaultKnowledgeReviewKernel().reviewSession(params);
  } catch (err) {
    log.warn("knowledge review failed", {
      sessionKey: params.sessionKey,
      sessionId: params.entry.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
