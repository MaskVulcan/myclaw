import type { OpenClawConfig } from "../config/config.js";
import {
  mergeSessionEntry,
  resolveAgentIdFromSessionKey,
  resolveStorePath,
  type SessionEntry,
  updateSessionStore,
} from "../config/sessions.js";

const DEFAULT_RECENT_TASK_LIMIT = 12;

function normalizeTaskId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTaskIdList(
  values: Array<string | undefined>,
  limit = DEFAULT_RECENT_TASK_LIMIT,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const taskId = normalizeTaskId(value);
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    out.push(taskId);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

type SessionTaskPointerContext = {
  sessionKey: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  cfg?: OpenClawConfig;
};

function resolveEffectiveStorePath(params: SessionTaskPointerContext): string | undefined {
  if (params.storePath) {
    return params.storePath;
  }
  if (!params.cfg) {
    return undefined;
  }
  return resolveStorePath(params.cfg.session?.store, {
    agentId: resolveAgentIdFromSessionKey(params.sessionKey),
  });
}

async function persistSessionEntryPatch(
  params: SessionTaskPointerContext & { patch: Partial<SessionEntry> },
) {
  const existing = params.sessionStore?.[params.sessionKey] ?? params.sessionEntry;
  const nextEntry = mergeSessionEntry(existing, params.patch);
  if (params.sessionStore) {
    params.sessionStore[params.sessionKey] = nextEntry;
  }
  const effectiveStorePath = resolveEffectiveStorePath(params);
  if (effectiveStorePath) {
    await updateSessionStore(effectiveStorePath, (store) => {
      store[params.sessionKey] = mergeSessionEntry(store[params.sessionKey], params.patch);
    });
  }
  return nextEntry;
}

export async function bindForegroundTaskToSession(
  params: SessionTaskPointerContext & {
    taskId: string;
    suspendedTaskIdToRemove?: string;
  },
): Promise<SessionEntry> {
  const taskId = normalizeTaskId(params.taskId);
  if (!taskId) {
    throw new Error("taskId is required");
  }
  const existing = params.sessionStore?.[params.sessionKey] ?? params.sessionEntry;
  const patch: Partial<SessionEntry> = {
    foregroundTaskId: taskId,
    recentTaskIds: normalizeTaskIdList([taskId, ...(existing?.recentTaskIds ?? [])]),
    suspendedTaskIds: normalizeTaskIdList(
      (existing?.suspendedTaskIds ?? []).filter(
        (value) => normalizeTaskId(value) !== normalizeTaskId(params.suspendedTaskIdToRemove),
      ),
    ),
    updatedAt: Date.now(),
  };
  return await persistSessionEntryPatch({ ...params, patch });
}

export async function suspendForegroundTaskForSession(
  params: SessionTaskPointerContext & {
    taskId: string;
  },
): Promise<SessionEntry> {
  const taskId = normalizeTaskId(params.taskId);
  if (!taskId) {
    throw new Error("taskId is required");
  }
  const existing = params.sessionStore?.[params.sessionKey] ?? params.sessionEntry;
  const patch: Partial<SessionEntry> = {
    foregroundTaskId:
      normalizeTaskId(existing?.foregroundTaskId) === taskId
        ? undefined
        : existing?.foregroundTaskId,
    recentTaskIds: normalizeTaskIdList([taskId, ...(existing?.recentTaskIds ?? [])]),
    suspendedTaskIds: normalizeTaskIdList([taskId, ...(existing?.suspendedTaskIds ?? [])]),
    updatedAt: Date.now(),
  };
  return await persistSessionEntryPatch({ ...params, patch });
}

export async function clearForegroundTaskForSession(
  params: SessionTaskPointerContext & {
    taskId?: string;
    keepInRecent?: boolean;
    removeFromSuspended?: boolean;
  },
): Promise<SessionEntry> {
  const requestedTaskId = normalizeTaskId(params.taskId);
  const existing = params.sessionStore?.[params.sessionKey] ?? params.sessionEntry;
  const activeForegroundTaskId = normalizeTaskId(existing?.foregroundTaskId);
  const effectiveTaskId = requestedTaskId ?? activeForegroundTaskId;
  const recentTaskIds =
    params.keepInRecent === false || !effectiveTaskId
      ? normalizeTaskIdList(existing?.recentTaskIds ?? [])
      : normalizeTaskIdList([effectiveTaskId, ...(existing?.recentTaskIds ?? [])]);
  const suspendedTaskIds = params.removeFromSuspended
    ? normalizeTaskIdList(
        (existing?.suspendedTaskIds ?? []).filter(
          (value) => normalizeTaskId(value) !== effectiveTaskId,
        ),
      )
    : normalizeTaskIdList(existing?.suspendedTaskIds ?? []);
  const patch: Partial<SessionEntry> = {
    foregroundTaskId:
      !effectiveTaskId || activeForegroundTaskId === effectiveTaskId
        ? undefined
        : existing?.foregroundTaskId,
    recentTaskIds,
    suspendedTaskIds,
    updatedAt: Date.now(),
  };
  return await persistSessionEntryPatch({ ...params, patch });
}
