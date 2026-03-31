import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import {
  isTaskBackend,
  isTaskRouteMode,
  isTaskState,
  isTaskWorkerRole,
  isTaskWorkerState,
  type TaskBackend,
  type TaskErrorRecord,
  type TaskEventActor,
  type TaskEventRecord,
  type TaskRecord,
  type TaskRouteMode,
  type TaskState,
  type TaskWorkerRecord,
  type TaskWorkerRole,
  type TaskWorkerState,
} from "./types.js";

type PersistedTaskRegistryVersion = 1;

type PersistedTaskRegistry = {
  version: PersistedTaskRegistryVersion;
  tasks: Record<string, TaskRecord>;
};

const REGISTRY_VERSION = 1 as const;
const withTaskRegistryLock = createAsyncLock();

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return normalizeString(value);
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeCounter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function normalizePriority(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  const input = asObject(value);
  if (!input) {
    return undefined;
  }
  const output: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (typeof entry === "boolean") {
      output[key] = entry;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeTaskError(value: unknown): TaskErrorRecord | undefined {
  const input = asObject(value);
  if (!input) {
    return undefined;
  }
  const at = normalizeTimestamp(input.at);
  const message = normalizeString(input.message);
  if (!at || !message) {
    return undefined;
  }
  return {
    at,
    message,
    code: normalizeString(input.code),
    retryable: typeof input.retryable === "boolean" ? input.retryable : undefined,
  };
}

function normalizeTaskWorker(value: unknown): TaskWorkerRecord | undefined {
  const input = asObject(value);
  if (!input) {
    return undefined;
  }
  const workerId = normalizeString(input.workerId);
  const role = input.role;
  const backend = input.backend;
  const state = input.state;
  const createdAt = normalizeTimestamp(input.createdAt);
  const updatedAt = normalizeTimestamp(input.updatedAt);
  if (
    !workerId ||
    !isTaskWorkerRole(role) ||
    !isTaskBackend(backend) ||
    !isTaskWorkerState(state) ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }
  return {
    workerId,
    role,
    backend,
    state,
    model: normalizeString(input.model),
    sessionKey: normalizeString(input.sessionKey),
    sessionId: normalizeString(input.sessionId),
    bindingKey: normalizeString(input.bindingKey),
    cwd: normalizeString(input.cwd),
    createdAt,
    updatedAt,
  };
}

function normalizeTaskRecord(value: unknown): TaskRecord | undefined {
  const input = asObject(value);
  if (!input) {
    return undefined;
  }

  const taskId = normalizeString(input.taskId);
  const ownerSessionKey = normalizeString(input.ownerSessionKey);
  const ownerChannel = normalizeString(input.ownerChannel);
  const routeMode = input.routeMode;
  const state = input.state;
  const backend = input.backend;
  const title = normalizeString(input.title);
  const goal = normalizeString(input.goal);
  const createdAt = normalizeTimestamp(input.createdAt);
  const updatedAt = normalizeTimestamp(input.updatedAt);

  if (
    !taskId ||
    !ownerSessionKey ||
    !ownerChannel ||
    !isTaskRouteMode(routeMode) ||
    !title ||
    !goal ||
    !isTaskState(state) ||
    !isTaskBackend(backend) ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }

  const workers = Array.isArray(input.workers)
    ? input.workers
        .map((entry) => normalizeTaskWorker(entry))
        .filter((entry): entry is TaskWorkerRecord => Boolean(entry))
    : [];
  const orchestrator = normalizeTaskWorker(input.orchestrator);

  return {
    taskId,
    ownerSessionKey,
    ownerChannel,
    ownerAccountId: normalizeString(input.ownerAccountId),
    ownerConversationId: normalizeIdentifier(input.ownerConversationId),
    ownerDeliveryContext: normalizeDeliveryContext(
      asObject(input.ownerDeliveryContext) as TaskRecord["ownerDeliveryContext"],
    ),
    routeMode,
    title,
    goal,
    acceptance: normalizeString(input.acceptance),
    cwd: normalizeString(input.cwd),
    state,
    backend,
    foreground: Boolean(input.foreground),
    priority: normalizePriority(input.priority),
    orchestrator,
    workers,
    lastDigest: normalizeString(input.lastDigest),
    lastUserVisibleSummary: normalizeString(input.lastUserVisibleSummary),
    lastPlannerIntentHash: normalizeString(input.lastPlannerIntentHash),
    createdAt,
    updatedAt,
    startedAt: normalizeTimestamp(input.startedAt),
    finishedAt: normalizeTimestamp(input.finishedAt),
    lastActivityAt: normalizeTimestamp(input.lastActivityAt),
    replyCount: normalizeCounter(input.replyCount),
    retryCount: normalizeCounter(input.retryCount),
    flags: normalizeBooleanRecord(input.flags),
    error: normalizeTaskError(input.error),
  };
}

function normalizeTaskEventActor(value: unknown): TaskEventActor | undefined {
  return value === "user" ||
    value === "router" ||
    value === "planner" ||
    value === "executor" ||
    value === "system"
    ? value
    : undefined;
}

function normalizeTaskEvent(value: unknown): TaskEventRecord | undefined {
  const input = asObject(value);
  if (!input) {
    return undefined;
  }
  const taskId = normalizeString(input.taskId);
  const type = normalizeString(input.type);
  const at = normalizeTimestamp(input.at);
  if (!taskId || !type || !at) {
    return undefined;
  }
  return {
    taskId,
    type,
    at,
    actor: normalizeTaskEventActor(input.actor),
    summary: normalizeString(input.summary),
    data: asObject(input.data),
  };
}

function serializeTaskMap(tasks: Map<string, TaskRecord>): PersistedTaskRegistry {
  const sortedEntries = Array.from(tasks.entries()).toSorted(([leftId], [rightId]) =>
    leftId.localeCompare(rightId),
  );
  const serialized: Record<string, TaskRecord> = {};
  for (const [taskId, task] of sortedEntries) {
    serialized[taskId] = task;
  }
  return {
    version: REGISTRY_VERSION,
    tasks: serialized,
  };
}

function cloneTaskMap(tasks: Map<string, TaskRecord>): Map<string, TaskRecord> {
  return new Map(tasks.entries());
}

function requireTaskId(taskId: string): string {
  const normalized = normalizeString(taskId);
  if (!normalized) {
    throw new Error("taskId is required");
  }
  return normalized;
}

function encodeTaskFileStem(taskId: string): string {
  return encodeURIComponent(requireTaskId(taskId));
}

async function persistTaskMap(
  tasks: Map<string, TaskRecord>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await writeJsonAtomic(resolveTaskRegistryPath(env), serializeTaskMap(tasks), {
    mode: 0o600,
    ensureDirMode: 0o700,
    trailingNewline: true,
  });
}

export function resolveTaskStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "tasks");
}

export function resolveTaskRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskStateDir(env), "registry.json");
}

export function resolveTaskEventsPath(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTaskStateDir(env), `${encodeTaskFileStem(taskId)}.events.jsonl`);
}

export async function loadTaskRegistryFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, TaskRecord>> {
  const raw = await readJsonFile<PersistedTaskRegistry>(resolveTaskRegistryPath(env));
  if (!raw || typeof raw !== "object" || raw.version !== REGISTRY_VERSION) {
    return new Map();
  }
  const out = new Map<string, TaskRecord>();
  const tasks = asObject(raw.tasks);
  if (!tasks) {
    return out;
  }
  for (const [taskId, entry] of Object.entries(tasks)) {
    const normalized = normalizeTaskRecord(entry);
    if (normalized && normalized.taskId === taskId) {
      out.set(taskId, normalized);
    }
  }
  return out;
}

export async function saveTaskRegistryToDisk(
  tasks: Map<string, TaskRecord>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await withTaskRegistryLock(async () => {
    await persistTaskMap(tasks, env);
  });
}

export async function listTaskRecords(env: NodeJS.ProcessEnv = process.env): Promise<TaskRecord[]> {
  const tasks = await loadTaskRegistryFromDisk(env);
  return Array.from(tasks.values()).toSorted((left, right) => {
    const timeDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

export async function getTaskRecord(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskRecord | undefined> {
  const tasks = await loadTaskRegistryFromDisk(env);
  return tasks.get(requireTaskId(taskId));
}

export async function upsertTaskRecord(
  task: TaskRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskRecord> {
  const normalized = normalizeTaskRecord(task);
  if (!normalized) {
    throw new Error("invalid task record");
  }
  return await withTaskRegistryLock(async () => {
    const tasks = await loadTaskRegistryFromDisk(env);
    tasks.set(normalized.taskId, normalized);
    await persistTaskMap(tasks, env);
    return normalized;
  });
}

export async function patchTaskRecord(
  taskId: string,
  updater: (
    current: TaskRecord | undefined,
  ) => TaskRecord | undefined | Promise<TaskRecord | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskRecord | undefined> {
  const normalizedTaskId = requireTaskId(taskId);
  return await withTaskRegistryLock(async () => {
    const tasks = await loadTaskRegistryFromDisk(env);
    const current = tasks.get(normalizedTaskId);
    const nextValue = await updater(current);
    if (nextValue === undefined) {
      if (current) {
        tasks.delete(normalizedTaskId);
        await persistTaskMap(tasks, env);
      }
      return undefined;
    }
    const normalized = normalizeTaskRecord(nextValue);
    if (!normalized || normalized.taskId !== normalizedTaskId) {
      throw new Error("invalid patched task record");
    }
    tasks.set(normalizedTaskId, normalized);
    await persistTaskMap(tasks, env);
    return normalized;
  });
}

export async function removeTaskRecord(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return await withTaskRegistryLock(async () => {
    const tasks = await loadTaskRegistryFromDisk(env);
    const removed = tasks.delete(requireTaskId(taskId));
    if (removed) {
      await persistTaskMap(tasks, env);
    }
    return removed;
  });
}

export async function appendTaskEvent(
  event: TaskEventRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskEventRecord> {
  const normalized = normalizeTaskEvent(event);
  if (!normalized) {
    throw new Error("invalid task event");
  }
  await withTaskRegistryLock(async () => {
    const eventsPath = resolveTaskEventsPath(normalized.taskId, env);
    await fs.mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    await fs.appendFile(eventsPath, `${JSON.stringify(normalized)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await fs.chmod(eventsPath, 0o600);
    } catch {
      // best-effort
    }
  });
  return normalized;
}

export async function readTaskEventsFromDisk(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskEventRecord[]> {
  const eventsPath = resolveTaskEventsPath(taskId, env);
  let raw = "";
  try {
    raw = await fs.readFile(eventsPath, "utf8");
  } catch {
    return [];
  }
  const out: TaskEventRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const normalized = normalizeTaskEvent(parsed);
      if (normalized) {
        out.push(normalized);
      }
    } catch {
      // ignore malformed event lines
    }
  }
  return out;
}

export function cloneTaskRegistry(tasks: Map<string, TaskRecord>): Map<string, TaskRecord> {
  return cloneTaskMap(tasks);
}

export function createTaskWorkerRecord(params: {
  workerId: string;
  role: TaskWorkerRole;
  backend: TaskBackend;
  state: TaskWorkerState;
  createdAt: number;
  updatedAt: number;
  model?: string;
  sessionKey?: string;
  sessionId?: string;
  bindingKey?: string;
  cwd?: string;
}): TaskWorkerRecord {
  const worker: TaskWorkerRecord = {
    workerId: params.workerId,
    role: params.role,
    backend: params.backend,
    state: params.state,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    model: params.model,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    bindingKey: params.bindingKey,
    cwd: params.cwd,
  };
  const normalized = normalizeTaskWorker(worker);
  if (!normalized) {
    throw new Error("invalid task worker record");
  }
  return normalized;
}

export function createTaskRecord(params: {
  taskId: string;
  ownerSessionKey: string;
  ownerChannel: string;
  routeMode: TaskRouteMode;
  title: string;
  goal: string;
  state: TaskState;
  backend: TaskBackend;
  createdAt?: number;
  updatedAt?: number;
  ownerAccountId?: string;
  ownerConversationId?: string;
  ownerDeliveryContext?: TaskRecord["ownerDeliveryContext"];
  acceptance?: string;
  cwd?: string;
  foreground?: boolean;
  priority?: number;
  orchestrator?: TaskWorkerRecord;
  workers?: TaskWorkerRecord[];
  lastDigest?: string;
  lastUserVisibleSummary?: string;
  lastPlannerIntentHash?: string;
  startedAt?: number;
  finishedAt?: number;
  lastActivityAt?: number;
  replyCount?: number;
  retryCount?: number;
  flags?: Record<string, boolean>;
  error?: TaskErrorRecord;
}): TaskRecord {
  const createdAt = params.createdAt ?? Date.now();
  const updatedAt = params.updatedAt ?? createdAt;
  const task: TaskRecord = {
    taskId: params.taskId,
    ownerSessionKey: params.ownerSessionKey,
    ownerChannel: params.ownerChannel,
    ownerAccountId: params.ownerAccountId,
    ownerConversationId: params.ownerConversationId,
    ownerDeliveryContext: params.ownerDeliveryContext,
    routeMode: params.routeMode,
    title: params.title,
    goal: params.goal,
    acceptance: params.acceptance,
    cwd: params.cwd,
    state: params.state,
    backend: params.backend,
    foreground: params.foreground ?? false,
    priority: params.priority ?? 0,
    orchestrator: params.orchestrator,
    workers: params.workers ?? [],
    lastDigest: params.lastDigest,
    lastUserVisibleSummary: params.lastUserVisibleSummary,
    lastPlannerIntentHash: params.lastPlannerIntentHash,
    createdAt,
    updatedAt,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    lastActivityAt: params.lastActivityAt,
    replyCount: params.replyCount,
    retryCount: params.retryCount,
    flags: params.flags,
    error: params.error,
  };
  const normalized = normalizeTaskRecord(task);
  if (!normalized) {
    throw new Error("invalid task record");
  }
  return normalized;
}
