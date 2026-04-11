import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_KERNEL_ID,
  resolveDefaultAgentKernel,
  runAgentKernel,
} from "./agent-kernel.js";
import * as piEmbedded from "./pi-embedded.js";

describe("agent-kernel facade", () => {
  it("resolves the embedded Pi runtime as the default kernel", () => {
    const kernel = resolveDefaultAgentKernel();

    expect(kernel.id).toBe(DEFAULT_AGENT_KERNEL_ID);
    expect(typeof kernel.run).toBe("function");
    expect(kernel.abortRun).toBe(piEmbedded.abortEmbeddedPiRun);
    expect(kernel.queueMessage).toBe(piEmbedded.queueEmbeddedPiMessage);
    expect(kernel.resolveSessionLane).toBe(piEmbedded.resolveEmbeddedSessionLane);
    expect(kernel.compactSession).toBe(piEmbedded.compactEmbeddedPiSession);
  });

  it("delegates runAgentKernel through the default kernel", async () => {
    const params = {
      sessionId: "session-1",
    } as Parameters<typeof piEmbedded.runEmbeddedPiAgent>[0];
    const result = {
      payloads: [],
      meta: {
        durationMs: 0,
      },
    } as Awaited<ReturnType<typeof piEmbedded.runEmbeddedPiAgent>>;
    const runEmbeddedPiAgentMock = vi
      .spyOn(piEmbedded, "runEmbeddedPiAgent")
      .mockResolvedValue(result);

    await expect(runAgentKernel(params)).resolves.toBe(result);
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledWith(params);
  });
});
