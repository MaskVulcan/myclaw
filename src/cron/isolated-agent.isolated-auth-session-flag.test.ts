import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRunCronIsolatedAgentTurn,
  resetRunCronIsolatedAgentTurnHarness,
  resolveSessionAuthProfileOverrideMock,
} from "./isolated-agent/run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

describe("isolated cron resolveSessionAuthProfileOverride isNewSession", () => {
  beforeEach(() => {
    resetRunCronIsolatedAgentTurnHarness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes isNewSession=false when sessionTarget is isolated", async () => {
    resolveSessionAuthProfileOverrideMock.mockResolvedValue(undefined);

    await runCronIsolatedAgentTurn({
      cfg: {},
      deps: {} as never,
      job: {
        id: "auth-flag",
        name: "Auth Flag",
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        payload: { kind: "agentTurn", message: "hi" },
        delivery: { mode: "none" },
      } as never,
      message: "hi",
      sessionKey: "cron:auth-flag",
    });

    expect(resolveSessionAuthProfileOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.any(String),
        isNewSession: false,
      }),
    );
  });
});
