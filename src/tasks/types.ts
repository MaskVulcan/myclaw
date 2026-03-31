import type { DeliveryContext } from "../utils/delivery-context.js";

export const TASK_ROUTE_MODES = ["conversation_bound", "virtual_foreground"] as const;
export type TaskRouteMode = (typeof TASK_ROUTE_MODES)[number];

export const TASK_STATES = [
  "planning",
  "pending_dispatch",
  "running",
  "waiting_user",
  "blocked",
  "replanning",
  "done",
  "failed",
  "stopped",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_BACKENDS = ["acp-codex", "codex-app-server", "pty-zellij"] as const;
export type TaskBackend = (typeof TASK_BACKENDS)[number];

export const TASK_WORKER_ROLES = ["router", "planner", "executor", "worker", "mirror"] as const;
export type TaskWorkerRole = (typeof TASK_WORKER_ROLES)[number];

export const TASK_WORKER_STATES = [
  "idle",
  "running",
  "waiting_user",
  "done",
  "failed",
  "stopped",
] as const;
export type TaskWorkerState = (typeof TASK_WORKER_STATES)[number];

export const TASK_ROUTER_ACTIONS = [
  "reply_now",
  "control",
  "continue_task",
  "open_task",
  "escalate_strong",
] as const;
export type TaskRouterAction = (typeof TASK_ROUTER_ACTIONS)[number];

export const TASK_PLANNER_ACTIONS = ["answer", "acp_persistent", "acp_parallel"] as const;
export type TaskPlannerAction = (typeof TASK_PLANNER_ACTIONS)[number];

export type TaskWorkerRecord = {
  workerId: string;
  role: TaskWorkerRole;
  backend: TaskBackend;
  state: TaskWorkerState;
  model?: string;
  sessionKey?: string;
  sessionId?: string;
  bindingKey?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
};

export type TaskErrorRecord = {
  at: number;
  message: string;
  code?: string;
  retryable?: boolean;
};

export type TaskRecord = {
  taskId: string;
  ownerSessionKey: string;
  ownerChannel: string;
  ownerAccountId?: string;
  ownerConversationId?: string;
  ownerDeliveryContext?: DeliveryContext;
  routeMode: TaskRouteMode;
  title: string;
  goal: string;
  acceptance?: string;
  cwd?: string;
  state: TaskState;
  backend: TaskBackend;
  foreground: boolean;
  priority: number;
  orchestrator?: TaskWorkerRecord;
  workers: TaskWorkerRecord[];
  lastDigest?: string;
  lastUserVisibleSummary?: string;
  lastPlannerIntentHash?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastActivityAt?: number;
  replyCount?: number;
  retryCount?: number;
  flags?: Record<string, boolean>;
  error?: TaskErrorRecord;
};

export type TaskEventActor = "user" | "router" | "planner" | "executor" | "system";

export type TaskEventRecord = {
  taskId: string;
  type: string;
  at: number;
  actor?: TaskEventActor;
  summary?: string;
  data?: Record<string, unknown>;
};

export type TaskRouterDecision =
  | {
      action: "reply_now";
      reply: string;
    }
  | {
      action: "control";
      command: string;
      targetTaskId?: string;
      reason?: string;
    }
  | {
      action: "continue_task";
      taskId: string;
      userMessage?: string;
      reason?: string;
    }
  | {
      action: "open_task";
      title: string;
      goal: string;
      acceptance?: string;
      preferredBackend?: TaskBackend;
      reason?: string;
    }
  | {
      action: "escalate_strong";
      reason: string;
    };

export type TaskPlannerDecision =
  | {
      action: "answer";
      reply: string;
    }
  | {
      action: "acp_persistent";
      title: string;
      goal: string;
      acceptance?: string;
      backend: "acp-codex" | "codex-app-server";
      cwd?: string;
    }
  | {
      action: "acp_parallel";
      title: string;
      goal: string;
      acceptance?: string;
      backend: "acp-codex" | "codex-app-server";
      workers: Array<{
        workerId: string;
        title: string;
        goal: string;
        cwd?: string;
      }>;
    };

export function isTaskRouteMode(value: unknown): value is TaskRouteMode {
  return typeof value === "string" && TASK_ROUTE_MODES.includes(value as TaskRouteMode);
}

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && TASK_STATES.includes(value as TaskState);
}

export function isTaskBackend(value: unknown): value is TaskBackend {
  return typeof value === "string" && TASK_BACKENDS.includes(value as TaskBackend);
}

export function isTaskWorkerRole(value: unknown): value is TaskWorkerRole {
  return typeof value === "string" && TASK_WORKER_ROLES.includes(value as TaskWorkerRole);
}

export function isTaskWorkerState(value: unknown): value is TaskWorkerState {
  return typeof value === "string" && TASK_WORKER_STATES.includes(value as TaskWorkerState);
}
