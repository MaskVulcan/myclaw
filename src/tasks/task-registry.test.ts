import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { captureEnv, withEnvAsync } from "../test-utils/env.js";
import {
  appendTaskEvent,
  createTaskRecord,
  createTaskWorkerRecord,
  getTaskRecord,
  listTaskRecords,
  loadTaskRegistryFromDisk,
  patchTaskRecord,
  readTaskEventsFromDisk,
  removeTaskRecord,
  resolveTaskEventsPath,
  resolveTaskRegistryPath,
  upsertTaskRecord,
} from "./task-registry.js";

describe("task registry persistence", () => {
  const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR", "NODE_ENV", "VITEST"]);

  afterEach(() => {
    envSnapshot.restore();
  });

  it("persists task records and reloads them from disk", async () => {
    await withTempDir({ prefix: "openclaw-tasks-" }, async (stateDir) => {
      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          NODE_ENV: undefined,
          VITEST: undefined,
        },
        async () => {
          const now = Date.now();
          const orchestrator = createTaskWorkerRecord({
            workerId: "planner-1",
            role: "planner",
            backend: "acp-codex",
            state: "running",
            createdAt: now,
            updatedAt: now,
            model: "codex-vip/gpt-5.4",
          });
          const task = createTaskRecord({
            taskId: "wx-task-1",
            ownerSessionKey: "agent:main:main",
            ownerChannel: "weixin",
            ownerAccountId: "default",
            ownerConversationId: "wx:chat:123",
            routeMode: "virtual_foreground",
            title: "优化首条回复延迟",
            goal: "把复杂执行切到独立 task executor",
            acceptance: "首条微信消息不等待完整执行",
            state: "running",
            backend: "acp-codex",
            foreground: true,
            priority: 10,
            orchestrator,
            workers: [orchestrator],
            createdAt: now,
            updatedAt: now,
            lastUserVisibleSummary: "任务已启动",
          });

          await upsertTaskRecord(task);

          const registryPath = resolveTaskRegistryPath();
          await expect(fs.readFile(registryPath, "utf8")).resolves.toContain('"wx-task-1"');

          const loaded = await loadTaskRegistryFromDisk();
          expect(loaded.get("wx-task-1")).toEqual(task);

          const direct = await getTaskRecord("wx-task-1");
          expect(direct).toEqual(task);

          const listed = await listTaskRecords();
          expect(listed).toEqual([task]);
        },
      );
    });
  });

  it("patches and removes task records without touching unrelated state", async () => {
    await withTempDir({ prefix: "openclaw-tasks-" }, async (stateDir) => {
      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          NODE_ENV: undefined,
          VITEST: undefined,
        },
        async () => {
          const now = Date.now();
          await upsertTaskRecord(
            createTaskRecord({
              taskId: "wx-task-2",
              ownerSessionKey: "agent:main:main",
              ownerChannel: "weixin",
              routeMode: "virtual_foreground",
              title: "跟进任务",
              goal: "验证 patch/remove",
              state: "planning",
              backend: "acp-codex",
              createdAt: now,
              updatedAt: now,
            }),
          );

          const patched = await patchTaskRecord("wx-task-2", (current) =>
            current
              ? {
                  ...current,
                  state: "waiting_user",
                  updatedAt: current.updatedAt + 1,
                  lastUserVisibleSummary: "等待用户补充信息",
                }
              : undefined,
          );

          expect(patched?.state).toBe("waiting_user");
          expect(patched?.lastUserVisibleSummary).toBe("等待用户补充信息");

          expect(await removeTaskRecord("wx-task-2")).toBe(true);
          expect(await getTaskRecord("wx-task-2")).toBeUndefined();
        },
      );
    });
  });

  it("appends per-task event logs as jsonl and keeps task ids filename-safe", async () => {
    await withTempDir({ prefix: "openclaw-tasks-" }, async (stateDir) => {
      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          NODE_ENV: undefined,
          VITEST: undefined,
        },
        async () => {
          const taskId = "wx/task 3";
          const now = Date.now();
          await appendTaskEvent({
            taskId,
            type: "task_created",
            at: now,
            actor: "system",
            summary: "task opened",
            data: { routeMode: "virtual_foreground" },
          });
          await appendTaskEvent({
            taskId,
            type: "state_changed",
            at: now + 1,
            actor: "planner",
            summary: "running",
          });

          const eventsPath = resolveTaskEventsPath(taskId);
          expect(path.basename(eventsPath)).not.toContain("/");
          await expect(fs.readFile(eventsPath, "utf8")).resolves.toContain('"task_created"');

          const events = await readTaskEventsFromDisk(taskId);
          expect(events).toEqual([
            {
              taskId,
              type: "task_created",
              at: now,
              actor: "system",
              summary: "task opened",
              data: { routeMode: "virtual_foreground" },
            },
            {
              taskId,
              type: "state_changed",
              at: now + 1,
              actor: "planner",
              summary: "running",
              data: undefined,
            },
          ]);
        },
      );
    });
  });

  it("ignores malformed persisted entries during reload", async () => {
    await withTempDir({ prefix: "openclaw-tasks-" }, async (stateDir) => {
      await withEnvAsync(
        {
          OPENCLAW_STATE_DIR: stateDir,
          NODE_ENV: undefined,
          VITEST: undefined,
        },
        async () => {
          const registryPath = resolveTaskRegistryPath();
          await fs.mkdir(path.dirname(registryPath), { recursive: true });
          await fs.writeFile(
            registryPath,
            `${JSON.stringify({
              version: 1,
              tasks: {
                valid: {
                  taskId: "valid",
                  ownerSessionKey: "agent:main:main",
                  ownerChannel: "weixin",
                  routeMode: "virtual_foreground",
                  title: "valid task",
                  goal: "keep me",
                  state: "running",
                  backend: "acp-codex",
                  foreground: true,
                  priority: 0,
                  workers: [],
                  createdAt: 1,
                  updatedAt: 2,
                },
                invalid: {
                  taskId: "invalid",
                  ownerChannel: "weixin",
                },
              },
            })}\n`,
            "utf8",
          );

          const loaded = await loadTaskRegistryFromDisk();
          expect(Array.from(loaded.keys())).toEqual(["valid"]);
        },
      );
    });
  });
});
