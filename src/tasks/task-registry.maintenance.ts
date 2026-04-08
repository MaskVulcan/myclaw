import { listTaskRecords } from "./task-registry.js";
import type { TaskBackend, TaskRecord, TaskState } from "./types.js";

type TaskRegistrySummary = {
  total: number;
  active: number;
  terminal: number;
  failures: number;
  byStatus: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    timed_out: number;
    cancelled: number;
    lost: number;
  };
  byRuntime: {
    subagent: number;
    acp: number;
    cli: number;
    cron: number;
  };
};

type TaskAuditSummary = {
  total: number;
  warnings: number;
  errors: number;
  byCode: {
    stale_queued: number;
    stale_running: number;
    lost: number;
    delivery_failed: number;
    missing_cleanup: number;
    inconsistent_timestamps: number;
  };
};

function createEmptyTaskRegistrySummary(): TaskRegistrySummary {
  return {
    total: 0,
    active: 0,
    terminal: 0,
    failures: 0,
    byStatus: {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      timed_out: 0,
      cancelled: 0,
      lost: 0,
    },
    byRuntime: {
      subagent: 0,
      acp: 0,
      cli: 0,
      cron: 0,
    },
  };
}

function createEmptyTaskAuditSummary(): TaskAuditSummary {
  return {
    total: 0,
    warnings: 0,
    errors: 0,
    byCode: {
      stale_queued: 0,
      stale_running: 0,
      lost: 0,
      delivery_failed: 0,
      missing_cleanup: 0,
      inconsistent_timestamps: 0,
    },
  };
}

function classifyStatus(state: TaskState):
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost"
  | "timed_out" {
  switch (state) {
    case "planning":
    case "pending_dispatch":
    case "replanning":
      return "queued";
    case "running":
    case "waiting_user":
      return "running";
    case "done":
      return "succeeded";
    case "failed":
    case "blocked":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return "lost";
  }
}

function classifyRuntime(backend: TaskBackend): keyof TaskRegistrySummary["byRuntime"] {
  switch (backend) {
    case "acp-codex":
    case "codex-app-server":
      return "acp";
    case "pty-zellij":
      return "cli";
    default:
      return "subagent";
  }
}

function summarizeTaskRecords(records: TaskRecord[]): TaskRegistrySummary {
  const summary = createEmptyTaskRegistrySummary();
  for (const task of records) {
    const status = classifyStatus(task.state);
    const runtime = classifyRuntime(task.backend);
    summary.total += 1;
    summary.byStatus[status] += 1;
    summary.byRuntime[runtime] += 1;
    if (status === "queued" || status === "running") {
      summary.active += 1;
    } else {
      summary.terminal += 1;
    }
    if (status === "failed" || status === "timed_out" || status === "lost") {
      summary.failures += 1;
    }
  }
  return summary;
}

export async function getInspectableTaskRegistrySummary(): Promise<TaskRegistrySummary> {
  try {
    return summarizeTaskRecords(await listTaskRecords());
  } catch {
    return createEmptyTaskRegistrySummary();
  }
}

export async function getInspectableTaskAuditSummary(): Promise<TaskAuditSummary> {
  return createEmptyTaskAuditSummary();
}
