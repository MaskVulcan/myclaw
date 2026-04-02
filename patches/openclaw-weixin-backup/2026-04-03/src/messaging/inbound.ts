import fs from "node:fs";
import path from "node:path";

import { logger } from "../util/logger.js";
import { generateId } from "../util/random.js";
import type { WeixinMessage, MessageItem, RefMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { resolveStateDir } from "../storage/state-dir.js";

// ---------------------------------------------------------------------------
// Context token store (in-process cache + disk persistence)
// ---------------------------------------------------------------------------

/**
 * contextToken is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound send. The in-memory map is the primary
 * lookup; a disk-backed file per account ensures tokens survive gateway restarts.
 */
const contextTokenStore = new Map<string, string>();
const restoredAccountIds = new Set<string>();

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

// ---------------------------------------------------------------------------
// Disk persistence helpers
// ---------------------------------------------------------------------------

function resolveContextTokenFilePath(accountId: string): string {
  return path.join(
    resolveStateDir(),
    "openclaw-weixin",
    "accounts",
    `${accountId}.context-tokens.json`,
  );
}

type PersistedContextTokenLookup = {
  hasToken: boolean;
  token?: string;
};

function readPersistedContextToken(
  accountId: string,
  userId: string,
): PersistedContextTokenLookup {
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    if (!fs.existsSync(filePath)) {
      return { hasToken: false };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const tokens = JSON.parse(raw) as Record<string, string>;
    const token = typeof tokens[userId] === "string" ? tokens[userId] : undefined;
    if (!token) {
      return { hasToken: false };
    }
    return { hasToken: true, token };
  } catch {
    return { hasToken: false };
  }
}

export type ContextTokenDiagnostics = {
  token?: string;
  state: "memory" | "restored" | "missing" | "persisted-mismatch";
  persistedOnDisk: boolean;
};

/** Persist all context tokens for a given account to disk. */
function persistContextTokens(accountId: string): void {
  const prefix = `${accountId}:`;
  const tokens: Record<string, string> = {};
  for (const [k, v] of contextTokenStore) {
    if (k.startsWith(prefix)) {
      tokens[k.slice(prefix.length)] = v;
    }
  }
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(tokens, null, 0), "utf-8");
  } catch (err) {
    logger.warn(`persistContextTokens: failed to write ${filePath}: ${String(err)}`);
  }
}

/**
 * Restore persisted context tokens for an account into the in-memory map.
 * Called once during gateway startAccount to survive restarts.
 */
export function restoreContextTokens(accountId: string): void {
  if (restoredAccountIds.has(accountId)) {
    return;
  }
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf-8");
    const tokens = JSON.parse(raw) as Record<string, string>;
    let count = 0;
    for (const [userId, token] of Object.entries(tokens)) {
      if (typeof token === "string" && token) {
        contextTokenStore.set(contextTokenKey(accountId, userId), token);
        count++;
      }
    }
    logger.info(`restoreContextTokens: restored ${count} tokens for account=${accountId}`);
  } catch (err) {
    logger.warn(`restoreContextTokens: failed to read ${filePath}: ${String(err)}`);
  } finally {
    restoredAccountIds.add(accountId);
  }
}

/** Remove all context tokens for a given account (memory + disk). */
export function clearContextTokensForAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const k of [...contextTokenStore.keys()]) {
    if (k.startsWith(prefix)) {
      contextTokenStore.delete(k);
    }
  }
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn(`clearContextTokensForAccount: failed to remove ${filePath}: ${String(err)}`);
  }
  restoredAccountIds.add(accountId);
  logger.info(`clearContextTokensForAccount: cleared tokens for account=${accountId}`);
}

/** Store a context token for a given account+user pair (memory + disk). */
export function setContextToken(accountId: string, userId: string, token: string): void {
  const k = contextTokenKey(accountId, userId);
  logger.debug(`setContextToken: key=${k}`);
  contextTokenStore.set(k, token);
  restoredAccountIds.add(accountId);
  persistContextTokens(accountId);
}

/** Retrieve the cached context token for a given account+user pair. */
export function getContextToken(accountId: string, userId: string): string | undefined {
  const diagnostics = inspectContextToken(accountId, userId);
  logger.debug(
    `getContextToken: key=${contextTokenKey(accountId, userId)} state=${diagnostics.state} found=${diagnostics.token !== undefined} storeSize=${contextTokenStore.size}`,
  );
  return diagnostics.token;
}

export function inspectContextToken(
  accountId: string,
  userId: string,
): ContextTokenDiagnostics {
  const k = contextTokenKey(accountId, userId);
  const inMemory = contextTokenStore.get(k);
  if (inMemory) {
    return {
      token: inMemory,
      state: "memory",
      persistedOnDisk: true,
    };
  }

  const persisted = readPersistedContextToken(accountId, userId);
  restoreContextTokens(accountId);

  const restored = contextTokenStore.get(k);
  if (restored) {
    return {
      token: restored,
      state: "restored",
      persistedOnDisk: persisted.hasToken,
    };
  }

  if (persisted.hasToken) {
    return {
      state: "persisted-mismatch",
      persistedOnDisk: true,
    };
  }

  return {
    state: "missing",
    persistedOnDisk: false,
  };
}

/**
 * Find all accountIds that have an active contextToken for the given userId.
 * Used to infer the sending bot account from the recipient address when
 * accountId is not explicitly provided (e.g. cron delivery).
 *
 * Returns all matching accountIds (not just the first) so the caller can
 * detect ambiguity when multiple accounts have sessions with the same user.
 */
export function findAccountIdsByContextToken(
  accountIds: string[],
  userId: string,
): string[] {
  return accountIds.filter((id) => {
    return inspectContextToken(id, userId).token !== undefined;
  });
}

/**
 * Reset internal state — only for tests.
 * @internal
 */
export function _resetForTest(): void {
  contextTokenStore.clear();
  restoredAccountIds.clear();
}

// ---------------------------------------------------------------------------
// Message ID generation
// ---------------------------------------------------------------------------

function generateMessageSid(): string {
  return generateId("openclaw-weixin");
}

/** Inbound context passed to the OpenClaw core pipeline (matches MsgContext shape). */
export type WeixinMsgContext = {
  Body: string;
  From: string;
  To: string;
  AccountId: string;
  OriginatingChannel: "openclaw-weixin";
  OriginatingTo: string;
  MessageSid: string;
  Timestamp?: number;
  Provider: "openclaw-weixin";
  ChatType: "direct";
  /** Set by monitor after resolveAgentRoute so dispatchReplyFromConfig uses the correct session. */
  SessionKey?: string;
  context_token?: string;
  MediaUrl?: string;
  MediaPath?: string;
  MediaType?: string;
  SenderId?: string;
  ReplyToBody?: string;
  ReplyToIsQuote?: boolean;
  /** Raw message body for framework command authorization. */
  CommandBody?: string;
  /** Whether the sender is authorized to execute slash commands. */
  CommandAuthorized?: boolean;
};

/** Returns true if the message item is a media type (image, video, file, or voice). */
export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

function normalizeSnippet(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function renderQuotedItem(item?: MessageItem): string | undefined {
  if (!item) {
    return undefined;
  }
  if (item.type === MessageItemType.TEXT) {
    return normalizeSnippet(item.text_item?.text);
  }
  if (item.type === MessageItemType.VOICE) {
    return normalizeSnippet(item.voice_item?.text) ?? "[voice]";
  }
  if (item.type === MessageItemType.IMAGE) {
    return "[image]";
  }
  if (item.type === MessageItemType.VIDEO) {
    return "[video]";
  }
  if (item.type === MessageItemType.FILE) {
    const name = normalizeSnippet(item.file_item?.file_name);
    return name ? `[file: ${name}]` : "[file]";
  }
  return undefined;
}

function renderQuotedMessage(ref?: RefMessage): string | undefined {
  if (!ref) {
    return undefined;
  }
  const parts: string[] = [];
  const pushUnique = (value: string | undefined) => {
    if (!value || parts.includes(value)) {
      return;
    }
    parts.push(value);
  };
  pushUnique(normalizeSnippet(ref.title));
  pushUnique(renderQuotedItem(ref.message_item));
  return parts.join("\n") || undefined;
}

function extractCurrentBody(itemList?: MessageItem[]): string {
  if (!itemList?.length) {
    return "";
  }
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    // Voice transcription should be treated as the current turn body when present.
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

function extractQuotedBody(itemList?: MessageItem[]): string | undefined {
  if (!itemList?.length) {
    return undefined;
  }
  for (const item of itemList) {
    const quoted = renderQuotedMessage(item.ref_msg);
    if (quoted) {
      return quoted;
    }
  }
  return undefined;
}

export type WeixinInboundMediaOpts = {
  /** Local path to decrypted image file. */
  decryptedPicPath?: string;
  /** Local path to transcoded/raw voice file (.wav or .silk). */
  decryptedVoicePath?: string;
  /** MIME type for the voice file (e.g. "audio/wav" or "audio/silk"). */
  voiceMediaType?: string;
  /** Local path to decrypted file attachment. */
  decryptedFilePath?: string;
  /** MIME type for the file attachment (guessed from file_name). */
  fileMediaType?: string;
  /** Local path to decrypted video file. */
  decryptedVideoPath?: string;
};

/**
 * Convert a WeixinMessage from getUpdates to the inbound MsgContext for the core pipeline.
 * Media: only pass MediaPath (local file, after CDN download + decrypt).
 * We never pass MediaUrl — the upstream CDN URL is encrypted/auth-only.
 * Priority when multiple media types present: image > video > file > voice.
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const from_user_id = msg.from_user_id ?? "";
  const body = extractCurrentBody(msg.item_list);
  const quotedBody = extractQuotedBody(msg.item_list);
  const ctx: WeixinMsgContext = {
    Body: body,
    From: from_user_id,
    To: from_user_id,
    AccountId: accountId,
    OriginatingChannel: "openclaw-weixin",
    OriginatingTo: from_user_id,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: "openclaw-weixin",
    ChatType: "direct",
    SenderId: from_user_id,
  };
  if (quotedBody) {
    ctx.ReplyToBody = quotedBody;
    ctx.ReplyToIsQuote = true;
  }
  if (msg.context_token) {
    ctx.context_token = msg.context_token;
  }

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath;
    ctx.MediaType = "image/*";
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath;
    ctx.MediaType = "video/mp4";
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath;
    ctx.MediaType = opts.fileMediaType ?? "application/octet-stream";
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath;
    ctx.MediaType = opts.voiceMediaType ?? "audio/wav";
  }

  return ctx;
}

/** Extract the context_token from an inbound WeixinMsgContext. */
export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token;
}
