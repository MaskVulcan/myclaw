import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  resolveSessionStoreTargets: vi.fn(),
  loadSessionStore: vi.fn(),
  getActiveMemorySearchManager: vi.fn(),
  resolveAgentWorkspaceDir: vi.fn(),
  loadKnowledgeReviewRecord: vi.fn(),
  readSessionTitleFieldsFromTranscript: vi.fn(),
  readSessionPreviewItemsFromTranscript: vi.fn(),
}));

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    resolveSessionStoreTargets: (...args: unknown[]) => hoisted.resolveSessionStoreTargets(...args),
    loadSessionStore: (...args: unknown[]) => hoisted.loadSessionStore(...args),
  };
});

vi.mock("../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager: (...args: unknown[]) =>
    hoisted.getActiveMemorySearchManager(...args),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: (...args: unknown[]) => hoisted.resolveAgentWorkspaceDir(...args),
}));

vi.mock("../agents/knowledge-review-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/knowledge-review-store.js")>();
  return {
    ...actual,
    loadKnowledgeReviewRecord: (...args: unknown[]) => hoisted.loadKnowledgeReviewRecord(...args),
  };
});

vi.mock("../gateway/session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/session-utils.js")>();
  return {
    ...actual,
    readSessionTitleFieldsFromTranscript: (...args: unknown[]) =>
      hoisted.readSessionTitleFieldsFromTranscript(...args),
    readSessionPreviewItemsFromTranscript: (...args: unknown[]) =>
      hoisted.readSessionPreviewItemsFromTranscript(...args),
  };
});

let searchSessions: typeof import("./service.js").searchSessions;
let searchMock: ReturnType<typeof vi.fn>;

describe("sessions-search service", () => {
  beforeEach(async () => {
    vi.resetModules();
    hoisted.resolveSessionStoreTargets.mockReset();
    hoisted.loadSessionStore.mockReset();
    hoisted.getActiveMemorySearchManager.mockReset();
    hoisted.resolveAgentWorkspaceDir.mockReset();
    hoisted.loadKnowledgeReviewRecord.mockReset();
    hoisted.readSessionTitleFieldsFromTranscript.mockReset();
    hoisted.readSessionPreviewItemsFromTranscript.mockReset();

    hoisted.resolveSessionStoreTargets.mockReturnValue([
      { agentId: "main", storePath: "/tmp/sessions-main.json" },
    ]);
    hoisted.loadSessionStore.mockReturnValue({
      "agent:main:main": {
        sessionId: "session-1",
        updatedAt: 10,
        sessionFile: "/tmp/session-1.jsonl",
      },
      "agent:main:other": {
        sessionId: "session-2",
        updatedAt: 20,
        sessionFile: "/tmp/session-2.jsonl",
      },
    });
    hoisted.resolveAgentWorkspaceDir.mockReturnValue("/tmp/workspace-main");
    hoisted.readSessionTitleFieldsFromTranscript.mockReturnValue({
      firstUserMessage: "Fallback first user",
      lastMessagePreview: "Fallback last preview",
    });
    hoisted.readSessionPreviewItemsFromTranscript.mockReturnValue([{ text: "fallback preview" }]);
    hoisted.loadKnowledgeReviewRecord.mockImplementation(async (_workspaceDir, sessionId) => {
      if (sessionId === "session-1") {
        return {
          schemaVersion: 1,
          sessionId,
          sessionKey: "agent:main:main",
          agentId: "main",
          reviewedAt: new Date().toISOString(),
          title: "Roadmap Session",
          summary: "Roadmap summary",
          tags: ["roadmap", "search"],
          previewItems: ["review preview"],
          messageCount: 2,
          userMessageCount: 1,
          assistantMessageCount: 1,
          userModel: {
            preferences: [],
            contexts: [],
            goals: [],
            notes: [],
          },
          automation: {
            commands: [],
            tools: [],
          },
        };
      }
      return null;
    });
    searchMock = vi.fn(async () => [
      {
        path: "sessions/session-1.jsonl",
        startLine: 1,
        endLine: 1,
        score: 0.92,
        snippet: "User: roadmap",
        source: "sessions",
      },
      {
        path: "memory/topic.md",
        startLine: 4,
        endLine: 8,
        score: 0.99,
        snippet: "memory hit",
        source: "memory",
      },
      {
        path: "sessions/session-1.jsonl",
        startLine: 2,
        endLine: 2,
        score: 0.83,
        snippet: "Assistant: status",
        source: "sessions",
      },
      {
        path: "sessions/session-2.jsonl",
        startLine: 1,
        endLine: 1,
        score: 0.71,
        snippet: "User: fallback",
        source: "sessions",
      },
    ]);
    hoisted.getActiveMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({ sources: ["sessions"] }),
        search: searchMock,
      },
    });

    ({ searchSessions } = await import("./service.js"));
  });

  it("groups transcript hits by session and enriches them with review records", async () => {
    const result = await searchSessions({
      cfg: {} as never,
      query: "roadmap",
      maxResults: 5,
      maxHitsPerSession: 2,
      requesterSessionKey: "agent:main:main",
    });

    expect(result.disabled).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      sessionKey: "agent:main:main",
      title: "Roadmap Session",
      summary: "Roadmap summary",
      previewItems: ["review preview"],
      tags: ["roadmap", "search"],
      hitCount: 2,
      maxScore: 0.92,
    });
    expect(result.results[0]?.hits).toEqual([
      expect.objectContaining({
        path: "sessions/session-1.jsonl",
        citation: "sessions/session-1.jsonl:1-1",
        score: 0.92,
      }),
      expect.objectContaining({
        path: "sessions/session-1.jsonl",
        citation: "sessions/session-1.jsonl:2-2",
        score: 0.83,
      }),
    ]);
    expect(result.results[1]).toMatchObject({
      sessionKey: "agent:main:other",
      title: "Fallback first user",
      previewItems: ["fallback preview"],
      hitCount: 1,
    });
    expect(hoisted.getActiveMemorySearchManager).toHaveBeenCalledWith({
      cfg: {},
      agentId: "main",
    });
    expect(searchMock).toHaveBeenCalledWith(
      "roadmap",
      expect.objectContaining({
        maxResults: 40,
        sessionKey: "agent:main:main",
        sources: ["sessions"],
      }),
    );
  });

  it("returns a disabled result when session search is not configured", async () => {
    hoisted.getActiveMemorySearchManager.mockResolvedValueOnce({
      manager: {
        status: () => ({ sources: ["memory"] }),
        search: vi.fn(async () => []),
      },
    });

    const result = await searchSessions({
      cfg: {} as never,
      query: "roadmap",
    });

    expect(result.disabled).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([
      {
        agentId: "main",
        message: "sessions source is not enabled for memory search",
      },
    ]);
  });
});
