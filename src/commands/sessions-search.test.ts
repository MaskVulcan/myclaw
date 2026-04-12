import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  searchSessions: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../sessions-search/service.js", () => ({
  searchSessions: mocks.searchSessions,
}));

process.env.FORCE_COLOR = "0";

import { sessionsSearchCommand } from "./sessions-search.js";

function makeRuntime(): { runtime: RuntimeEnv; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    runtime: {
      log: (msg: unknown) => logs.push(String(msg)),
      error: (msg: unknown) => errors.push(String(msg)),
      exit: (code: number) => {
        throw new Error(`exit ${code}`);
      },
    },
    logs,
    errors,
  };
}

describe("sessionsSearchCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
  });

  it("writes JSON output through the shared search service", async () => {
    mocks.searchSessions.mockResolvedValue({
      query: "roadmap",
      targets: [{ agentId: "main", storePath: "/tmp/sessions.json" }],
      disabled: false,
      warnings: [],
      results: [
        {
          sessionKey: "agent:main:main",
          sessionId: "session-1",
          agentId: "main",
          updatedAt: 1_764_990_000_000,
          title: "Roadmap Session",
          summary: "Review summary",
          previewItems: ["preview"],
          tags: ["roadmap"],
          hitCount: 1,
          maxScore: 0.91,
          hits: [
            {
              path: "sessions/session-1.jsonl",
              startLine: 1,
              endLine: 2,
              score: 0.91,
              snippet: "User: roadmap",
              source: "sessions",
              citation: "sessions/session-1.jsonl:1-2",
            },
          ],
        },
      ],
    });

    const { runtime, logs } = makeRuntime();
    await sessionsSearchCommand(
      {
        query: "roadmap",
        json: true,
        agent: "main",
        maxResults: "3",
        maxHitsPerSession: "1",
        minScore: "0.4",
      },
      runtime,
    );

    expect(mocks.searchSessions).toHaveBeenCalledWith({
      cfg: {},
      query: "roadmap",
      store: undefined,
      agent: "main",
      allAgents: undefined,
      maxResults: 3,
      maxHitsPerSession: 1,
      minScore: 0.4,
    });
    expect(JSON.parse(logs[0] ?? "{}")).toMatchObject({
      query: "roadmap",
      disabled: false,
      results: [expect.objectContaining({ title: "Roadmap Session" })],
    });
  });

  it("renders matched sessions in text mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    mocks.searchSessions.mockResolvedValue({
      query: "roadmap",
      targets: [{ agentId: "main", storePath: "/tmp/sessions.json" }],
      disabled: false,
      warnings: [{ agentId: "main", message: "memory search warming up" }],
      results: [
        {
          sessionKey: "agent:main:main",
          sessionId: "session-1",
          agentId: "main",
          updatedAt: Date.now() - 5 * 60_000,
          title: "Roadmap Session",
          summary: "Review summary",
          previewItems: ["preview line"],
          tags: ["roadmap"],
          hitCount: 1,
          maxScore: 0.91,
          hits: [
            {
              path: "sessions/session-1.jsonl",
              startLine: 1,
              endLine: 2,
              score: 0.91,
              snippet: "User: roadmap",
              source: "sessions",
              citation: "sessions/session-1.jsonl:1-2",
            },
          ],
        },
      ],
    });

    const { runtime, logs } = makeRuntime();
    try {
      await sessionsSearchCommand({ query: "roadmap" }, runtime);
    } finally {
      vi.useRealTimers();
    }

    const output = logs.join("\n");
    expect(output).toContain("Session search query: roadmap");
    expect(output).toContain("Targets: main");
    expect(output).toContain("memory search warming up");
    expect(output).toContain("Matched sessions: 1");
    expect(output).toContain("Roadmap Session");
    expect(output).toContain("summary: Review summary");
    expect(output).toContain("preview: preview line");
    expect(output).toContain("sessions/session-1.jsonl:1-2 (0.91): User: roadmap");
  });

  it("rejects invalid numeric flags", async () => {
    const { runtime, errors } = makeRuntime();

    await expect(
      sessionsSearchCommand(
        {
          query: "roadmap",
          maxResults: "0",
        },
        runtime,
      ),
    ).rejects.toThrow("exit 1");

    expect(errors).toEqual(["--max-results must be a positive integer"]);
    expect(mocks.searchSessions).not.toHaveBeenCalled();
  });

  it("requires a non-empty query", async () => {
    const { runtime, errors } = makeRuntime();

    await expect(sessionsSearchCommand({}, runtime)).rejects.toThrow("exit 1");

    expect(errors).toEqual(["query is required"]);
    expect(mocks.searchSessions).not.toHaveBeenCalled();
  });
});
