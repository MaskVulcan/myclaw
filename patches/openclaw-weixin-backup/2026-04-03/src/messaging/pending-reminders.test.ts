import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deliverWeixinOutboundPayloadMock = vi.hoisted(() => vi.fn());

vi.mock("./send-payload.js", () => ({
  deliverWeixinOutboundPayload: (...args: unknown[]) => deliverWeixinOutboundPayloadMock(...args),
}));

import { flushPendingRemindersForRecipient } from "./pending-reminders.js";

describe("flushPendingRemindersForRecipient", () => {
  let stateDir = "";

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-pending-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    deliverWeixinOutboundPayloadMock.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("flushes only the latest pending reminder for the same user and leaves other users intact", async () => {
    const queuePath = path.join(stateDir, "openclaw-weixin", "pending-reminders.json");
    await fs.mkdir(path.dirname(queuePath), { recursive: true });
    await fs.writeFile(
      queuePath,
      JSON.stringify([
        {
          id: "r1-old",
          accountId: "acc-1",
          to: "wx-user-1",
          createdAt: 1,
          source: "heartbeat",
          payloads: [{ text: "4月3日 周五旧提醒" }],
        },
        {
          id: "r1-new",
          accountId: "acc-1",
          to: "wx-user-1",
          createdAt: 3,
          source: "heartbeat",
          payloads: [
            { text: "4月4日 周六 09:00 开会" },
            { text: "4月4日 周六安排", mediaUrls: ["/tmp/calendar.png"] },
          ],
        },
        {
          id: "r2",
          accountId: "acc-1",
          to: "wx-user-2",
          createdAt: 2,
          source: "heartbeat",
          payloads: [{ text: "should stay" }],
        },
      ]),
      "utf-8",
    );

    const result = await flushPendingRemindersForRecipient({
      accountId: "acc-1",
      to: "wx-user-1",
      opts: {
        baseUrl: "https://example.test",
        contextToken: "ctx-1",
      },
      cdnBaseUrl: "https://cdn.example.test",
    });

    expect(result).toEqual({
      flushed: 1,
      remaining: 0,
    });
    expect(deliverWeixinOutboundPayloadMock.mock.calls.map((call) => call[0])).toEqual([
      {
        to: "wx-user-1",
        text: "4月4日 周六 09:00 开会",
        opts: {
          baseUrl: "https://example.test",
          contextToken: "ctx-1",
        },
        cdnBaseUrl: "https://cdn.example.test",
      },
      {
        to: "wx-user-1",
        text: "4月4日 周六安排",
        mediaUrl: "/tmp/calendar.png",
        opts: {
          baseUrl: "https://example.test",
          contextToken: "ctx-1",
        },
        cdnBaseUrl: "https://cdn.example.test",
      },
    ]);

    const remaining = JSON.parse(await fs.readFile(queuePath, "utf-8")) as Array<Record<string, unknown>>;
    expect(remaining).toEqual([
      {
        id: "r2",
        accountId: "acc-1",
        to: "wx-user-2",
        createdAt: 2,
        source: "heartbeat",
        payloads: [{ text: "should stay" }],
      },
    ]);
  });
});
