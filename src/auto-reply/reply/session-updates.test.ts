import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildWorkspaceSkillSnapshot: vi.fn(),
  ensureSkillsWatcher: vi.fn(),
  getSkillsSnapshotVersion: vi.fn(),
  updateSessionStore: vi.fn(async () => undefined),
  getRemoteSkillEligibility: vi.fn(() => ({ platforms: [] })),
}));

vi.mock("../../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: mocks.buildWorkspaceSkillSnapshot,
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  ensureSkillsWatcher: mocks.ensureSkillsWatcher,
  getSkillsSnapshotVersion: mocks.getSkillsSnapshotVersion,
}));

vi.mock("../../config/sessions.js", () => ({
  resolveSessionFilePath: vi.fn(),
  resolveSessionFilePathOptions: vi.fn(),
  updateSessionStore: mocks.updateSessionStore,
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: mocks.getRemoteSkillEligibility,
}));

let ensureSkillSnapshot: typeof import("./session-updates.js").ensureSkillSnapshot;

async function loadFreshModuleForTest() {
  vi.resetModules();
  ({ ensureSkillSnapshot } = await import("./session-updates.js"));
}

describe("ensureSkillSnapshot", () => {
  beforeEach(async () => {
    await loadFreshModuleForTest();
    delete process.env.OPENCLAW_TEST_FAST;
    mocks.buildWorkspaceSkillSnapshot.mockReset().mockImplementation((_workspaceDir, opts) => ({
      prompt: `skills:${(opts?.skillFilter ?? []).join(",")}`,
      skills: [],
      resolvedSkills: [],
      version: opts?.snapshotVersion,
      ...(opts?.skillFilter === undefined ? {} : { skillFilter: opts.skillFilter }),
    }));
    mocks.ensureSkillsWatcher.mockReset();
    mocks.getSkillsSnapshotVersion.mockReset().mockReturnValue(3);
    mocks.updateSessionStore.mockClear();
    mocks.getRemoteSkillEligibility.mockClear();
  });

  it("refreshes a cached filtered snapshot when the requested skill filter needs smart-calendar", async () => {
    const sessionStore = {
      "agent:main:openclaw-weixin:primary:direct:wx-user-1": {
        sessionId: "session-1",
        updatedAt: 1,
        skillsSnapshot: {
          prompt: "old",
          skills: [],
          resolvedSkills: [],
          version: 3,
          skillFilter: ["document-processing-pipeline"],
        },
      },
    };

    const result = await ensureSkillSnapshot({
      sessionEntry: sessionStore["agent:main:openclaw-weixin:primary:direct:wx-user-1"],
      sessionStore,
      sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      isFirstTurnInSession: false,
      workspaceDir: "/tmp/workspace",
      cfg: {},
      skillFilter: ["smart-calendar"],
    });

    expect(mocks.buildWorkspaceSkillSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.buildWorkspaceSkillSnapshot).toHaveBeenCalledWith(
      "/tmp/workspace",
      expect.objectContaining({
        config: {},
        skillFilter: ["smart-calendar"],
        snapshotVersion: 3,
      }),
    );
    expect(result.skillsSnapshot).toMatchObject({
      prompt: "skills:smart-calendar",
      skillFilter: ["smart-calendar"],
      version: 3,
    });
    expect(result.sessionEntry?.skillsSnapshot).toMatchObject({
      skillFilter: ["smart-calendar"],
    });
  });

  it("reuses an unrestricted cached snapshot for bundled skill injection", async () => {
    const snapshot = {
      prompt: "all skills",
      skills: [],
      resolvedSkills: [],
      version: 3,
    };

    const result = await ensureSkillSnapshot({
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 1,
        skillsSnapshot: snapshot,
      },
      sessionStore: {},
      sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      isFirstTurnInSession: false,
      workspaceDir: "/tmp/workspace",
      cfg: {},
      skillFilter: ["smart-calendar"],
    });

    expect(mocks.buildWorkspaceSkillSnapshot).not.toHaveBeenCalled();
    expect(result.skillsSnapshot).toBe(snapshot);
  });
});
