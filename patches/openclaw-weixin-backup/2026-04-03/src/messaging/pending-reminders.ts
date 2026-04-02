import fs from "node:fs/promises";
import path from "node:path";

import type { WeixinApiOptions } from "../api/api.js";
import { logger } from "../util/logger.js";
import { resolveStateDir } from "../storage/state-dir.js";

import { markdownToPlainText } from "./send.js";
import { deliverWeixinOutboundPayload } from "./send-payload.js";

export type PendingWeixinReminderPayload = {
  text?: string;
  mediaUrls?: string[];
};

type PendingWeixinReminder = {
  id: string;
  accountId: string;
  to: string;
  createdAt: number;
  source?: string;
  reason?: string;
  sessionKey?: string;
  payloads: PendingWeixinReminderPayload[];
};

function resolveReminderSource(value?: string): string {
  return value?.trim() || "heartbeat";
}

function buildReminderKey(entry: Pick<PendingWeixinReminder, "accountId" | "to" | "source">) {
  return `${entry.accountId}\u0000${entry.to}\u0000${resolveReminderSource(entry.source)}`;
}

function compactPendingReminderQueue(entries: PendingWeixinReminder[]): PendingWeixinReminder[] {
  const deduped = new Map<string, PendingWeixinReminder>();
  for (const entry of entries) {
    deduped.set(buildReminderKey(entry), entry);
  }
  return [...deduped.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function resolvePendingReminderFilePath(): string {
  return path.join(resolveStateDir(), "openclaw-weixin", "pending-reminders.json");
}

function normalizePayload(value: unknown): PendingWeixinReminderPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : undefined;
  const mediaUrls = Array.isArray(record.mediaUrls)
    ? record.mediaUrls.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (!text?.trim() && mediaUrls.length === 0) {
    return null;
  }
  return {
    ...(text ? { text } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
  };
}

function normalizeEntry(value: unknown): PendingWeixinReminder | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const payloads = Array.isArray(record.payloads)
    ? record.payloads
        .map((payload) => normalizePayload(payload))
        .filter((payload): payload is PendingWeixinReminderPayload => Boolean(payload))
    : [];
  if (!accountId || !to || payloads.length === 0) {
    return null;
  }
  return {
    id:
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    to,
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    source: resolveReminderSource(typeof record.source === "string" ? record.source : undefined),
    ...(typeof record.reason === "string" && record.reason.trim().length > 0
      ? { reason: record.reason.trim() }
      : {}),
    ...(typeof record.sessionKey === "string" && record.sessionKey.trim().length > 0
      ? { sessionKey: record.sessionKey.trim() }
      : {}),
    payloads,
  };
}

async function readPendingReminderQueue(): Promise<PendingWeixinReminder[]> {
  const filePath = resolvePendingReminderFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return compactPendingReminderQueue(
      parsed
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is PendingWeixinReminder => Boolean(entry)),
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writePendingReminderQueue(entries: PendingWeixinReminder[]): Promise<void> {
  const filePath = resolvePendingReminderFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries), "utf-8");
}

async function deliverQueuedPayload(params: {
  to: string;
  payload: PendingWeixinReminderPayload;
  opts: WeixinApiOptions & { contextToken?: string };
  cdnBaseUrl: string;
}) {
  const text = markdownToPlainText(params.payload.text ?? "");
  const mediaUrls = Array.isArray(params.payload.mediaUrls) ? params.payload.mediaUrls : [];

  if (mediaUrls.length === 0) {
    if (!text.trim()) {
      return;
    }
    await deliverWeixinOutboundPayload({
      to: params.to,
      text,
      opts: params.opts,
      cdnBaseUrl: params.cdnBaseUrl,
    });
    return;
  }

  for (const [index, mediaUrl] of mediaUrls.entries()) {
    await deliverWeixinOutboundPayload({
      to: params.to,
      text: index === 0 ? text : "",
      mediaUrl,
      opts: params.opts,
      cdnBaseUrl: params.cdnBaseUrl,
    });
  }
}

export async function flushPendingRemindersForRecipient(params: {
  accountId: string;
  to: string;
  opts: WeixinApiOptions & { contextToken?: string };
  cdnBaseUrl: string;
}): Promise<{ flushed: number; remaining: number }> {
  const accountId = params.accountId.trim();
  const to = params.to.trim();
  if (!accountId || !to || !params.opts.contextToken?.trim()) {
    return { flushed: 0, remaining: 0 };
  }

  const queue = await readPendingReminderQueue();
  const compactedQueue = compactPendingReminderQueue(queue);
  if (compactedQueue.length !== queue.length) {
    await writePendingReminderQueue(compactedQueue);
  }
  const targetEntries = compactedQueue.filter(
    (entry) => entry.accountId === accountId && entry.to === to,
  );
  if (targetEntries.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  const deliveredIds = new Set<string>();
  for (const entry of targetEntries) {
    try {
      for (const payload of entry.payloads) {
        await deliverQueuedPayload({
          to,
          payload,
          opts: params.opts,
          cdnBaseUrl: params.cdnBaseUrl,
        });
      }
      deliveredIds.add(entry.id);
    } catch (error) {
      logger.warn(
        `flushPendingRemindersForRecipient: stop after failure accountId=${accountId} to=${to} id=${entry.id} err=${String(error)}`,
      );
      break;
    }
  }

  if (deliveredIds.size === 0) {
    return {
      flushed: 0,
      remaining: targetEntries.length,
    };
  }

  const remaining = compactedQueue.filter((entry) => !deliveredIds.has(entry.id));
  await writePendingReminderQueue(remaining);
  logger.info(
    `flushPendingRemindersForRecipient: flushed=${deliveredIds.size} remaining=${remaining.length} accountId=${accountId} to=${to}`,
  );
  return {
    flushed: deliveredIds.size,
    remaining: remaining.filter((entry) => entry.accountId === accountId && entry.to === to).length,
  };
}
