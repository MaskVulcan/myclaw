import {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  resolveEmbeddedSessionLane,
  runEmbeddedPiAgent,
  waitForEmbeddedPiRunEnd,
} from "./pi-embedded.js";

export const DEFAULT_AGENT_KERNEL_ID = "pi-embedded" as const;

export type AgentKernelId = typeof DEFAULT_AGENT_KERNEL_ID;
export type AgentKernelRunParams = Parameters<typeof runEmbeddedPiAgent>[0];
export type AgentKernelRunResult = Awaited<ReturnType<typeof runEmbeddedPiAgent>>;

export type AgentKernel = {
  id: AgentKernelId;
  run: (params: AgentKernelRunParams) => Promise<AgentKernelRunResult>;
  abortRun: typeof abortEmbeddedPiRun;
  isRunActive: typeof isEmbeddedPiRunActive;
  isRunStreaming: typeof isEmbeddedPiRunStreaming;
  queueMessage: typeof queueEmbeddedPiMessage;
  waitForRunEnd: typeof waitForEmbeddedPiRunEnd;
  resolveSessionLane: typeof resolveEmbeddedSessionLane;
  compactSession: typeof compactEmbeddedPiSession;
};

// This is the first runtime seam above the embedded Pi integration.
// Future backends can plug in here without leaking Pi naming upward.
const embeddedPiAgentKernel: AgentKernel = {
  id: DEFAULT_AGENT_KERNEL_ID,
  run: (params) => runEmbeddedPiAgent(params),
  abortRun: abortEmbeddedPiRun,
  isRunActive: isEmbeddedPiRunActive,
  isRunStreaming: isEmbeddedPiRunStreaming,
  queueMessage: queueEmbeddedPiMessage,
  waitForRunEnd: waitForEmbeddedPiRunEnd,
  resolveSessionLane: resolveEmbeddedSessionLane,
  compactSession: compactEmbeddedPiSession,
};

export function resolveDefaultAgentKernel(): AgentKernel {
  return embeddedPiAgentKernel;
}

export async function runAgentKernel(params: AgentKernelRunParams): Promise<AgentKernelRunResult> {
  return await resolveDefaultAgentKernel().run(params);
}
