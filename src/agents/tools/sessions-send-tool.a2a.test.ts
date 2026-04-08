import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentStep from "./agent-step.js";
import * as sessionsAnnounceTarget from "./sessions-announce-target.js";

const runAgentStepSpy = vi.spyOn(agentStep, "runAgentStep");
const resolveAnnounceTargetSpy = vi.spyOn(
  sessionsAnnounceTarget,
  "resolveAnnounceTarget",
);

describe("runSessionsSendA2AFlow announce delivery", () => {
  let runSessionsSendA2AFlow: typeof import("./sessions-send-tool.a2a.js").runSessionsSendA2AFlow;
  let __testing: typeof import("./sessions-send-tool.a2a.js").__testing;
  let mockCallGateway: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    ({ runSessionsSendA2AFlow, __testing } = await import("./sessions-send-tool.a2a.js"));
  });

  beforeEach(() => {
    mockCallGateway = vi.fn().mockResolvedValue({});
    runAgentStepSpy.mockReset();
    runAgentStepSpy.mockResolvedValue("Test announce reply");
    resolveAnnounceTargetSpy.mockReset();
    __testing.setDepsForTest({ callGateway: mockCallGateway });
  });

  afterEach(() => {
    __testing.setDepsForTest();
  });

  afterAll(() => {
    runAgentStepSpy.mockRestore();
    resolveAnnounceTargetSpy.mockRestore();
  });

  it("passes threadId through to gateway send for Telegram forum topics", async () => {
    resolveAnnounceTargetSpy.mockResolvedValue({
      channel: "telegram",
      to: "-100123",
      threadId: "554",
    });

    await runSessionsSendA2AFlow({
      targetSessionKey: "agent:main:telegram:group:-100123:topic:554",
      displayKey: "agent:main:telegram:group:-100123:topic:554",
      message: "Test message",
      announceTimeoutMs: 10_000,
      maxPingPongTurns: 0,
      roundOneReply: "Worker completed successfully",
    });

    const sendCall = mockCallGateway.mock.calls.find(
      (call: unknown[]) => (call[0] as { method: string }).method === "send",
    );
    expect(sendCall).toBeDefined();
    const sendParams = (sendCall![0] as { params: Record<string, unknown> }).params;
    expect(sendParams.to).toBe("-100123");
    expect(sendParams.channel).toBe("telegram");
    expect(sendParams.threadId).toBe("554");
  });

  it("omits threadId for non-topic sessions", async () => {
    resolveAnnounceTargetSpy.mockResolvedValue({
      channel: "discord",
      to: "channel:dev",
    });

    await runSessionsSendA2AFlow({
      targetSessionKey: "agent:main:discord:group:dev",
      displayKey: "agent:main:discord:group:dev",
      message: "Test message",
      announceTimeoutMs: 10_000,
      maxPingPongTurns: 0,
      roundOneReply: "Worker completed successfully",
    });

    const sendCall = mockCallGateway.mock.calls.find(
      (call: unknown[]) => (call[0] as { method: string }).method === "send",
    );
    expect(sendCall).toBeDefined();
    const sendParams = (sendCall![0] as { params: Record<string, unknown> }).params;
    expect(sendParams.channel).toBe("discord");
    expect(sendParams.threadId).toBeUndefined();
  });
});
