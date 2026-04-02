import fs from "node:fs";
import { getHistoryLimitFromSessionKey } from "../../agents/pi-embedded-runner/history.js";
import { normalizeProviderId } from "../../agents/provider-id.js";
import { normalizeChatType } from "../../channels/chat-type.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveSessionTranscriptCandidates } from "../../gateway/session-transcript-files.fs.js";
import { stripAssistantInternalScaffolding } from "../../shared/text/assistant-visible-text.js";
import { stripInlineDirectiveTagsForDisplay } from "../../utils/directive-tags.js";
import type { TemplateContext } from "../templating.js";
import { stripInboundMetadata } from "./strip-inbound-meta.js";

const WEIXIN_PROVIDER_ID = "openclaw-weixin";
const TRANSCRIPT_TAIL_CHUNK_BYTES = 32 * 1024;
const TRANSCRIPT_TAIL_MAX_BYTES = 256 * 1024;
const EXTRA_SCANNED_USER_TURNS = 6;
const MAX_SCANNED_USER_TURNS = 24;
const MIN_SCANNED_VISIBLE_MESSAGES = 24;
const MAX_RECALL_SNIPPETS = 2;
const MAX_RECALL_MESSAGE_CHARS = 220;
const MIN_MATCH_SCORE = 2;

const LATIN_TOKEN_RE = /[a-z0-9][a-z0-9._:/-]{1,31}/gi;
const HAN_SEGMENT_RE = /\p{Script=Han}{2,}/gu;

const EN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "did",
  "for",
  "from",
  "have",
  "how",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "not",
  "now",
  "of",
  "on",
  "or",
  "our",
  "pls",
  "please",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you",
  "your",
]);

const ZH_STOPWORDS = new Set([
  "一下",
  "一个",
  "一些",
  "不是",
  "什么",
  "今天",
  "现在",
  "他们",
  "你们",
  "你的",
  "你说",
  "其实",
  "再说",
  "刚刚",
  "刚才",
  "可以",
  "只是",
  "哪里",
  "回复",
  "多少",
  "如何",
  "如果",
  "完全",
  "已经",
  "帮我",
  "怎么",
  "我们",
  "我是",
  "我的",
  "是否",
  "时候",
  "最新",
  "现在",
  "有没有",
  "本来",
  "机器人",
  "然后",
  "继续",
  "能否",
  "自己",
  "这个",
  "还是",
  "问题",
  "需要",
  "默认",
  "那个",
]);

type TranscriptRole = "user" | "assistant";

type VisibleTranscriptMessage = {
  index: number;
  role: TranscriptRole;
  text: string;
};

type RecallSnippet = {
  start: number;
  end: number;
  score: number;
  messages: VisibleTranscriptMessage[];
};

type BuildWeixinTranscriptRecallParams = {
  sessionCtx: TemplateContext;
  cfg: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  storePath?: string;
  agentId?: string;
  currentBody?: string;
  resetTriggered?: boolean;
};

type TranscriptJsonLine = {
  message?: {
    role?: unknown;
    content?: unknown;
  };
};

function resolveInboundProvider(ctx: TemplateContext): string | undefined {
  const channel =
    typeof ctx.OriginatingChannel === "string"
      ? normalizeProviderId(ctx.OriginatingChannel)
      : undefined;
  if (channel) {
    return channel;
  }
  const surface = typeof ctx.Surface === "string" ? normalizeProviderId(ctx.Surface) : undefined;
  if (surface) {
    return surface;
  }
  const provider = typeof ctx.Provider === "string" ? normalizeProviderId(ctx.Provider) : undefined;
  return provider && provider !== "webchat" ? provider : undefined;
}

function isWeixinDirectContext(ctx: TemplateContext): boolean {
  if (resolveInboundProvider(ctx) !== WEIXIN_PROVIDER_ID) {
    return false;
  }
  const chatType = normalizeChatType(ctx.ChatType);
  return !chatType || chatType === "direct";
}

function normalizeVisibleText(role: TranscriptRole, raw: string): string {
  const strippedDirectives = stripInlineDirectiveTagsForDisplay(raw).text.replace(/\r\n/g, "\n");
  const trimmed = strippedDirectives.trim();
  if (!trimmed) {
    return "";
  }
  const visible =
    role === "user" ? stripInboundMetadata(trimmed) : stripAssistantInternalScaffolding(trimmed);
  return visible.replace(/\n{3,}/g, "\n\n").trim();
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return stripInlineDirectiveTagsForDisplay(content).text.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    const type = typeof part.type === "string" ? part.type : "";
    const text = typeof part.text === "string" ? part.text : "";
    if (!text) {
      continue;
    }
    if (type === "text" || type === "output_text" || type === "input_text") {
      parts.push(stripInlineDirectiveTagsForDisplay(text).text);
    }
  }
  return parts.join("\n").trim();
}

function parseVisibleTranscriptMessage(
  line: string,
): Omit<VisibleTranscriptMessage, "index"> | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as TranscriptJsonLine;
    const role = parsed?.message?.role;
    if (role !== "user" && role !== "assistant") {
      return null;
    }
    const text = normalizeVisibleText(role, extractTextFromContent(parsed?.message?.content));
    if (!text) {
      return null;
    }
    return { role, text };
  } catch {
    return null;
  }
}

function resolveExistingTranscriptPath(params: {
  sessionId?: string;
  storePath?: string;
  sessionFile?: string;
  agentId?: string;
}): string | undefined {
  const sessionId = params.sessionId?.trim();
  if (!sessionId) {
    return undefined;
  }
  const candidates = resolveSessionTranscriptCandidates(
    sessionId,
    params.storePath,
    params.sessionFile,
    params.agentId,
  );
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function readTailVisibleMessages(params: {
  sessionId?: string;
  storePath?: string;
  sessionFile?: string;
  agentId?: string;
  recentUserTurnLimit: number;
}): VisibleTranscriptMessage[] {
  const transcriptPath = resolveExistingTranscriptPath(params);
  if (!transcriptPath) {
    return [];
  }

  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const stat = fs.fstatSync(fd);
    if (stat.size <= 0) {
      return [];
    }

    const targetUserTurns = Math.min(
      MAX_SCANNED_USER_TURNS,
      params.recentUserTurnLimit + EXTRA_SCANNED_USER_TURNS,
    );
    const reversedMessages: Array<Omit<VisibleTranscriptMessage, "index">> = [];
    let position = stat.size;
    let scannedBytes = 0;
    let trailingPartial = "";
    let scannedUserTurns = 0;
    let shouldStop = false;

    while (position > 0 && scannedBytes < TRANSCRIPT_TAIL_MAX_BYTES && !shouldStop) {
      const chunkSize = Math.min(
        TRANSCRIPT_TAIL_CHUNK_BYTES,
        position,
        TRANSCRIPT_TAIL_MAX_BYTES - scannedBytes,
      );
      const start = position - chunkSize;
      const buffer = Buffer.allocUnsafe(chunkSize);
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, start);
      if (bytesRead <= 0) {
        break;
      }
      scannedBytes += bytesRead;
      position = start;

      const chunk = buffer.toString("utf-8", 0, bytesRead);
      const combined = `${chunk}${trailingPartial}`;
      const lines = combined.split(/\r?\n/);
      trailingPartial = lines.shift() ?? "";

      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parsed = parseVisibleTranscriptMessage(lines[i] ?? "");
        if (!parsed) {
          continue;
        }
        reversedMessages.push(parsed);
        if (parsed.role === "user") {
          scannedUserTurns += 1;
        }
        if (
          scannedUserTurns >= targetUserTurns &&
          reversedMessages.length >= MIN_SCANNED_VISIBLE_MESSAGES
        ) {
          shouldStop = true;
          break;
        }
      }
    }

    if (!shouldStop && position === 0 && trailingPartial.trim()) {
      const parsed = parseVisibleTranscriptMessage(trailingPartial);
      if (parsed) {
        reversedMessages.push(parsed);
      }
    }

    return reversedMessages.toReversed().map((message, index) => ({ ...message, index }));
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

function addToken(target: Set<string>, token: string): void {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  if (/^\p{Script=Han}+$/u.test(normalized)) {
    if (normalized.length < 2 || ZH_STOPWORDS.has(normalized)) {
      return;
    }
    target.add(normalized);
    return;
  }
  if (normalized.length < 2 || EN_STOPWORDS.has(normalized)) {
    return;
  }
  if (/^\d+$/.test(normalized) && normalized.length < 3) {
    return;
  }
  target.add(normalized);
}

function collectHanTokens(text: string, target: Set<string>): void {
  HAN_SEGMENT_RE.lastIndex = 0;
  for (const match of text.matchAll(HAN_SEGMENT_RE)) {
    const chars = Array.from(match[0] ?? "");
    if (chars.length < 2) {
      continue;
    }
    if (chars.length <= 6) {
      addToken(target, chars.join(""));
    }
    const maxWindow = Math.min(3, chars.length);
    for (let width = 2; width <= maxWindow; width += 1) {
      for (let i = 0; i <= chars.length - width; i += 1) {
        addToken(target, chars.slice(i, i + width).join(""));
      }
    }
  }
}

function tokenizeRecallText(text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();
  collectHanTokens(normalized, tokens);
  LATIN_TOKEN_RE.lastIndex = 0;
  for (const match of normalized.matchAll(LATIN_TOKEN_RE)) {
    addToken(tokens, match[0] ?? "");
  }
  return Array.from(tokens);
}

function resolveQueryTokens(params: BuildWeixinTranscriptRecallParams): string[] {
  const currentBody = normalizeVisibleText("user", params.currentBody ?? "");
  const currentTokens = tokenizeRecallText(currentBody);
  const lowSignalCurrentBody =
    currentTokens.length > 0 &&
    (currentBody.length <= 4 ||
      (currentBody.length <= 6 &&
        currentTokens.length <= 2 &&
        currentTokens.every((token) => token.length <= 2)));
  if (currentTokens.length > 0 && !lowSignalCurrentBody) {
    return currentTokens;
  }
  const replyTokens = tokenizeRecallText(
    normalizeVisibleText("user", params.sessionCtx.ReplyToBody ?? ""),
  );
  return replyTokens.length > 0 ? replyTokens : currentTokens;
}

function selectOlderMessages(
  messages: VisibleTranscriptMessage[],
  recentUserTurnLimit: number,
): VisibleTranscriptMessage[] {
  let userTurns = 0;
  let cutoff = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") {
      continue;
    }
    userTurns += 1;
    if (userTurns > recentUserTurnLimit) {
      return messages.slice(0, cutoff);
    }
    cutoff = i;
  }
  return [];
}

function scoreToken(token: string): number {
  if (/^\d+$/.test(token)) {
    return 3;
  }
  return token.length >= 4 ? 3 : 2;
}

function scoreMessage(queryTokens: string[], messageText: string): number {
  const candidateTokens = new Set(tokenizeRecallText(messageText));
  if (candidateTokens.size === 0) {
    return 0;
  }
  let score = 0;
  for (const token of queryTokens) {
    if (!candidateTokens.has(token)) {
      continue;
    }
    score += scoreToken(token);
  }
  return score;
}

function resolveSnippetWindow(
  messages: VisibleTranscriptMessage[],
  index: number,
): {
  start: number;
  end: number;
} {
  const message = messages[index];
  if (!message) {
    return { start: index, end: index };
  }
  if (message.role === "assistant") {
    let start = index;
    for (let i = index - 1; i >= Math.max(0, index - 2); i -= 1) {
      if (messages[i]?.role === "user") {
        start = i;
        break;
      }
    }
    return { start, end: index };
  }
  let end = index;
  for (let i = index + 1; i < Math.min(messages.length, index + 3); i += 1) {
    if (messages[i]?.role === "assistant") {
      end = i;
      break;
    }
    if (messages[i]?.role === "user") {
      break;
    }
  }
  return { start: index, end };
}

function windowsOverlap(left: RecallSnippet, right: RecallSnippet): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function truncateMessageText(text: string): string {
  if (text.length <= MAX_RECALL_MESSAGE_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_RECALL_MESSAGE_CHARS - 1).trimEnd()}…`;
}

function buildRecallSnippets(
  messages: VisibleTranscriptMessage[],
  queryTokens: string[],
): RecallSnippet[] {
  const windows = new Map<string, RecallSnippet>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const score = scoreMessage(queryTokens, message.text);
    if (score < MIN_MATCH_SCORE) {
      continue;
    }
    const { start, end } = resolveSnippetWindow(messages, index);
    const key = `${start}:${end}`;
    const snippet: RecallSnippet = {
      start,
      end,
      score,
      messages: messages.slice(start, end + 1).map((entry) => ({
        ...entry,
        text: truncateMessageText(entry.text),
      })),
    };
    const existing = windows.get(key);
    if (!existing || existing.score < snippet.score) {
      windows.set(key, snippet);
    }
  }

  const ordered = Array.from(windows.values()).toSorted((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.end - left.end;
  });

  const selected: RecallSnippet[] = [];
  for (const snippet of ordered) {
    if (selected.length >= MAX_RECALL_SNIPPETS) {
      break;
    }
    if (selected.some((existing) => windowsOverlap(existing, snippet))) {
      continue;
    }
    selected.push(snippet);
  }
  return selected;
}

function buildRecallBlock(snippets: RecallSnippet[]): string | undefined {
  if (snippets.length === 0) {
    return undefined;
  }
  const payload = snippets.map((snippet) => ({
    messages: snippet.messages.map((message) => ({
      role: message.role,
      text: message.text,
    })),
  }));
  return [
    "Source: same Weixin DM transcript recall (older than the active history window; approximate lexical match)",
    "Relevant older same-chat snippets (untrusted, may be partial; use only if relevant):",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export function buildWeixinTranscriptRecall(
  params: BuildWeixinTranscriptRecallParams,
): string | undefined {
  if (params.resetTriggered) {
    return undefined;
  }
  if (!isWeixinDirectContext(params.sessionCtx)) {
    return undefined;
  }

  const sessionKey = params.sessionKey?.trim() || params.sessionCtx.SessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }

  const recentUserTurnLimit = getHistoryLimitFromSessionKey(sessionKey, params.cfg);
  if (
    typeof recentUserTurnLimit !== "number" ||
    !Number.isFinite(recentUserTurnLimit) ||
    recentUserTurnLimit <= 0
  ) {
    return undefined;
  }

  const queryTokens = resolveQueryTokens(params);
  if (queryTokens.length === 0) {
    return undefined;
  }

  const transcriptMessages = readTailVisibleMessages({
    sessionId: params.sessionId ?? params.sessionCtx.SessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    recentUserTurnLimit,
  });
  if (transcriptMessages.length === 0) {
    return undefined;
  }

  const olderMessages = selectOlderMessages(transcriptMessages, recentUserTurnLimit);
  if (olderMessages.length === 0) {
    return undefined;
  }

  const snippets = buildRecallSnippets(olderMessages, queryTokens);
  return buildRecallBlock(snippets);
}
