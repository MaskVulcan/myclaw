import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";

const loadConfigMock = vi.hoisted(() =>
  vi.fn(() => ({
    agents: {
      defaults: {
        model: { primary: "pi:opus" },
        models: { "pi:opus": {} },
        contextTokens: 32000,
      },
      list: [
        { id: "main", default: false },
        { id: "voice", default: true },
      ],
    },
    session: {
      store: "/tmp/sessions-{agentId}.json",
    },
  })),
);

const resolveStorePathMock = vi.hoisted(() =>
  vi.fn((_store: string | undefined, opts?: { agentId?: string }) => {
    return `/tmp/sessions-${opts?.agentId ?? "missing"}.json`;
  }),
);
const loadSessionStoreMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: loadConfigMock,
  };
});

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    resolveStorePath: resolveStorePathMock,
    loadSessionStore: loadSessionStoreMock,
  };
});

import { sessionsSummaryCommand } from "./sessions-summary.js";

function createRuntime(): { runtime: RuntimeEnv; logs: string[] } {
  const logs: string[] = [];
  return {
    runtime: {
      log: (msg: unknown) => logs.push(String(msg)),
      error: vi.fn(),
      exit: vi.fn(),
    },
    logs,
  };
}

describe("sessionsSummaryCommand default store agent selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockImplementation(() => ({
      agents: {
        defaults: {
          model: { primary: "pi:opus" },
          models: { "pi:opus": {} },
          contextTokens: 32000,
        },
        list: [
          { id: "main", default: false },
          { id: "voice", default: true },
        ],
      },
      session: {
        store: "/tmp/sessions-{agentId}.json",
      },
    }));
    resolveStorePathMock.mockImplementation(
      (_store: string | undefined, opts?: { agentId?: string }) => {
        return `/tmp/sessions-${opts?.agentId ?? "missing"}.json`;
      },
    );
    loadSessionStoreMock.mockReset();
  });

  it("aggregates rows across all configured agents in JSON output", async () => {
    loadSessionStoreMock
      .mockReturnValueOnce({
        main_row: {
          sessionId: "s1",
          updatedAt: Date.now() - 60_000,
          model: "pi:opus",
          totalTokens: 1000,
          totalTokensFresh: true,
        },
      })
      .mockReturnValueOnce({
        voice_row: {
          sessionId: "s2",
          updatedAt: Date.now() - 120_000,
          model: "pi:opus",
          totalTokens: 2000,
          totalTokensFresh: true,
        },
      });
    const { runtime, logs } = createRuntime();

    await sessionsSummaryCommand({ allAgents: true, json: true, recent: "0" }, runtime);

    const payload = JSON.parse(logs[0] ?? "{}") as {
      allAgents?: boolean;
      count?: number;
      agents?: Array<{ agentId?: string; count?: number; knownTokens?: number }>;
      totals?: { knownTokens?: number };
    };
    expect(payload.allAgents).toBe(true);
    expect(payload.count).toBe(2);
    expect(payload.totals?.knownTokens).toBe(3000);
    expect(payload.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "main", count: 1, knownTokens: 1000 }),
        expect.objectContaining({ agentId: "voice", count: 1, knownTokens: 2000 }),
      ]),
    );
  });
});
