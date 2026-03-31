import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { loadSessionStore, saveSessionStore } from "../config/sessions.js";
import {
  bindForegroundTaskToSession,
  clearForegroundTaskForSession,
  suspendForegroundTaskForSession,
} from "./session-pointers.js";

describe("session task pointers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function createStoreFixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-pointers-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "sess-main",
      updatedAt: Date.now(),
    };
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: sessionEntry,
    };
    await saveSessionStore(storePath, sessionStore);
    return { storePath, sessionKey, sessionStore, sessionEntry };
  }

  it("binds a foreground task and persists recent ids", async () => {
    const fixture = await createStoreFixture();
    const next = await bindForegroundTaskToSession({
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
      taskId: "task-1",
    });

    expect(next.foregroundTaskId).toBe("task-1");
    expect(next.recentTaskIds).toEqual(["task-1"]);
    expect(fixture.sessionStore[fixture.sessionKey]?.foregroundTaskId).toBe("task-1");

    const persisted = loadSessionStore(fixture.storePath, { skipCache: true });
    expect(persisted[fixture.sessionKey]?.foregroundTaskId).toBe("task-1");
    expect(persisted[fixture.sessionKey]?.recentTaskIds).toEqual(["task-1"]);
  });

  it("suspends a task and clears it from the foreground", async () => {
    const fixture = await createStoreFixture();
    fixture.sessionEntry.foregroundTaskId = "task-1";
    fixture.sessionEntry.recentTaskIds = ["task-1"];
    fixture.sessionStore[fixture.sessionKey] = fixture.sessionEntry;
    await saveSessionStore(fixture.storePath, fixture.sessionStore);

    const next = await suspendForegroundTaskForSession({
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
      taskId: "task-1",
    });

    expect(next.foregroundTaskId).toBeUndefined();
    expect(next.recentTaskIds).toEqual(["task-1"]);
    expect(next.suspendedTaskIds).toEqual(["task-1"]);
  });

  it("clears the foreground task and optionally removes it from suspended ids", async () => {
    const fixture = await createStoreFixture();
    fixture.sessionEntry.foregroundTaskId = "task-2";
    fixture.sessionEntry.recentTaskIds = ["task-2", "task-1"];
    fixture.sessionEntry.suspendedTaskIds = ["task-2", "task-1"];
    fixture.sessionStore[fixture.sessionKey] = fixture.sessionEntry;
    await saveSessionStore(fixture.storePath, fixture.sessionStore);

    const next = await clearForegroundTaskForSession({
      sessionKey: fixture.sessionKey,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      storePath: fixture.storePath,
      taskId: "task-2",
      removeFromSuspended: true,
    });

    expect(next.foregroundTaskId).toBeUndefined();
    expect(next.recentTaskIds).toEqual(["task-2", "task-1"]);
    expect(next.suspendedTaskIds).toEqual(["task-1"]);
  });
});
