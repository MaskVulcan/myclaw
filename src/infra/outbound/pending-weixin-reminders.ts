import fs from "node:fs/promises";
import path from "node:path";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { resolveStateDir } from "../../config/paths.js";

export type PendingWeixinReminderPayload = Pick<ReplyPayload, "text" | "mediaUrls">;

export type PendingWeixinReminder = {
  id: string;
  accountId: string;
  to: string;
  createdAt: number;
  source: "heartbeat";
  reason?: string;
  sessionKey?: string;
  payloads: PendingWeixinReminderPayload[];
};

function buildPendingReminderKey(
  entry: Pick<PendingWeixinReminder, "accountId" | "to" | "source">,
) {
  return `${entry.accountId}\u0000${entry.to}\u0000${entry.source}`;
}

function compactPendingWeixinReminderQueue(entries: PendingWeixinReminder[]) {
  const deduped = new Map<string, PendingWeixinReminder>();
  for (const entry of entries) {
    deduped.set(buildPendingReminderKey(entry), entry);
  }
  return [...deduped.values()].toSorted((a, b) => a.createdAt - b.createdAt);
}

function resolvePendingWeixinReminderFilePath(stateDir = resolveStateDir()): string {
  return path.join(stateDir, "openclaw-weixin", "pending-reminders.json");
}

function normalizePendingPayload(
  payload: PendingWeixinReminderPayload,
): PendingWeixinReminderPayload {
  const text = typeof payload.text === "string" ? payload.text : undefined;
  const mediaUrls = Array.isArray(payload.mediaUrls)
    ? payload.mediaUrls.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  return {
    ...(text ? { text } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
  };
}

function hasPendingPayloadContent(payload: PendingWeixinReminderPayload): boolean {
  return Boolean(payload.text?.trim() || payload.mediaUrls?.length);
}

function normalizePendingReminderEntry(value: unknown): PendingWeixinReminder | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  const to = typeof record.to === "string" ? record.to.trim() : "";
  if (!accountId || !to) {
    return null;
  }
  const payloads = Array.isArray(record.payloads)
    ? record.payloads
        .map((payload) => normalizePendingPayload((payload ?? {}) as PendingWeixinReminderPayload))
        .filter(hasPendingPayloadContent)
    : [];
  if (payloads.length === 0) {
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
    source: "heartbeat",
    ...(typeof record.reason === "string" && record.reason.trim().length > 0
      ? { reason: record.reason.trim() }
      : {}),
    ...(typeof record.sessionKey === "string" && record.sessionKey.trim().length > 0
      ? { sessionKey: record.sessionKey.trim() }
      : {}),
    payloads,
  };
}

async function readPendingWeixinReminderQueue(stateDir = resolveStateDir()) {
  const filePath = resolvePendingWeixinReminderFilePath(stateDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return compactPendingWeixinReminderQueue(
      parsed
        .map((entry) => normalizePendingReminderEntry(entry))
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

async function writePendingWeixinReminderQueue(
  entries: PendingWeixinReminder[],
  stateDir = resolveStateDir(),
) {
  const filePath = resolvePendingWeixinReminderFilePath(stateDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries), "utf-8");
}

export async function enqueuePendingWeixinReminder(params: {
  accountId: string;
  to: string;
  payloads: PendingWeixinReminderPayload[];
  reason?: string;
  sessionKey?: string;
  createdAt?: number;
  stateDir?: string;
}) {
  const accountId = params.accountId.trim();
  const to = params.to.trim();
  const payloads = params.payloads
    .map((payload) => normalizePendingPayload(payload))
    .filter(hasPendingPayloadContent);
  if (!accountId || !to || payloads.length === 0) {
    return null;
  }

  const stateDir = params.stateDir ?? resolveStateDir();
  const existing = await readPendingWeixinReminderQueue(stateDir);
  const entry: PendingWeixinReminder = {
    id: `pending-${params.createdAt ?? Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    to,
    createdAt: params.createdAt ?? Date.now(),
    source: "heartbeat",
    ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
    ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
    payloads,
  };
  const nextEntries = compactPendingWeixinReminderQueue([
    ...existing.filter(
      (existingEntry) => buildPendingReminderKey(existingEntry) !== buildPendingReminderKey(entry),
    ),
    entry,
  ]);
  await writePendingWeixinReminderQueue(nextEntries, stateDir);
  return entry;
}
