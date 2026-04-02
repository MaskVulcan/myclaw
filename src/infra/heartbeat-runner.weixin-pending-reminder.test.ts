import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { seedSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";

const deliverOutboundPayloadsMock = vi.hoisted(() => vi.fn());

vi.mock("./outbound/deliver.js", () => ({
  deliverOutboundPayloads: (...args: unknown[]) => deliverOutboundPayloadsMock(...args),
}));

afterEach(() => {
  deliverOutboundPayloadsMock.mockReset();
  setActivePluginRegistry(createTestRegistry());
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runHeartbeatOnce Weixin pending reminders", () => {
  it("queues reminder payloads when Weixin rejects a proactive send", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const stateDir = path.join(tmpDir, "state");
      vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

      setActivePluginRegistry(
        createTestRegistry([
          {
            pluginId: "openclaw-weixin",
            plugin: createOutboundTestPlugin({
              id: "openclaw-weixin",
              outbound: {
                deliveryMode: "direct",
                sendText: vi.fn().mockResolvedValue({
                  channel: "openclaw-weixin",
                  messageId: "msg-1",
                }),
              },
            }),
            source: "test",
          },
        ]),
      );

      replySpy.mockResolvedValue({
        text: "📅 4月3日 周五安排",
        mediaUrl: "/tmp/calendar.png",
      });
      deliverOutboundPayloadsMock.mockRejectedValueOnce(
        new Error("sendMessage failed: ret=-2 (invalid context)"),
      );

      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "openclaw-weixin",
              to: "wx-user-1@im.wechat",
              accountId: "primary",
            },
          },
        },
        channels: {
          "openclaw-weixin": {},
        },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);
      await seedSessionStore(storePath, sessionKey, {
        lastChannel: "openclaw-weixin",
        lastProvider: "openclaw-weixin",
        lastTo: "wx-user-1@im.wechat",
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: "ran",
        }),
      );
      const queued = JSON.parse(
        await fs.readFile(
          path.join(stateDir, "openclaw-weixin", "pending-reminders.json"),
          "utf-8",
        ),
      ) as Array<Record<string, unknown>>;
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        accountId: "primary",
        to: "wx-user-1@im.wechat",
        source: "heartbeat",
        payloads: [
          {
            text: "📅 4月3日 周五安排",
            mediaUrls: ["/tmp/calendar.png"],
          },
        ],
      });
    });
  });
});
