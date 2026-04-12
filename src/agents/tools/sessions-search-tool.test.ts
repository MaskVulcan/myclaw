import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSessionsMock = vi.fn();
const resolveSessionToolContextMock = vi.fn();
const resolveEffectiveSessionToolsVisibilityMock = vi.fn();
const createAgentToAgentPolicyMock = vi.fn();
const createSessionVisibilityGuardMock = vi.fn();

vi.mock("../../sessions-search/service.js", () => ({
  searchSessions: (...args: unknown[]) => searchSessionsMock(...args),
}));

vi.mock("./sessions-helpers.js", () => ({
  resolveSessionToolContext: (...args: unknown[]) => resolveSessionToolContextMock(...args),
  resolveEffectiveSessionToolsVisibility: (...args: unknown[]) =>
    resolveEffectiveSessionToolsVisibilityMock(...args),
  createAgentToAgentPolicy: (...args: unknown[]) => createAgentToAgentPolicyMock(...args),
  createSessionVisibilityGuard: (...args: unknown[]) => createSessionVisibilityGuardMock(...args),
}));

let createSessionsSearchTool: typeof import("./sessions-search-tool.js").createSessionsSearchTool;

describe("sessions-search-tool", () => {
  beforeEach(async () => {
    vi.resetModules();
    searchSessionsMock.mockReset();
    resolveSessionToolContextMock.mockReset();
    resolveEffectiveSessionToolsVisibilityMock.mockReset();
    createAgentToAgentPolicyMock.mockReset();
    createSessionVisibilityGuardMock.mockReset();

    resolveSessionToolContextMock.mockReturnValue({
      cfg: {},
      effectiveRequesterKey: "agent:main:main",
    });
    resolveEffectiveSessionToolsVisibilityMock.mockReturnValue("tree");
    createAgentToAgentPolicyMock.mockReturnValue({
      enabled: false,
      matchesAllow: vi.fn(),
      isAllowed: vi.fn(),
    });
    createSessionVisibilityGuardMock.mockResolvedValue({
      check: (sessionKey: string) =>
        sessionKey.startsWith("agent:main:")
          ? { allowed: true }
          : { allowed: false, status: "forbidden", error: "blocked" },
    });
    searchSessionsMock.mockResolvedValue({
      query: "roadmap",
      targets: [{ agentId: "main", storePath: "/tmp/sessions.json" }],
      disabled: false,
      warnings: [],
      results: [],
    });

    ({ createSessionsSearchTool } = await import("./sessions-search-tool.js"));
  });

  it("routes session search through the shared service with requester visibility filtering", async () => {
    const tool = createSessionsSearchTool({
      agentSessionKey: "agent:main:main",
      sandboxed: true,
      config: {} as never,
    });

    const result = await tool.execute("call-1", {
      query: "roadmap",
      maxResults: 3,
      maxHitsPerSession: 1,
      minScore: 0.4,
    });

    expect(searchSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: {},
        query: "roadmap",
        agent: "main",
        requesterSessionKey: "agent:main:main",
        maxResults: 3,
        maxHitsPerSession: 1,
        minScore: 0.4,
      }),
    );
    const call = searchSessionsMock.mock.calls[0]?.[0] as {
      filterSessionKey?: (sessionKey: string) => boolean | Promise<boolean>;
    };
    expect(await call.filterSessionKey?.("agent:main:child")).toBe(true);
    expect(await call.filterSessionKey?.("agent:other:main")).toBe(false);
    expect(result.details).toMatchObject({
      query: "roadmap",
      disabled: false,
      results: [],
    });
  });
});
