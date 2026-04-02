import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRuntime, mockSessionsConfig, writeStore } from "./sessions.test-helpers.js";

process.env.FORCE_COLOR = "0";

mockSessionsConfig();

import { sessionsSummaryCommand } from "./sessions-summary.js";

function writeTranscript(store: string, sessionId: string, lines: unknown[]): string {
  const transcriptPath = path.join(path.dirname(store), `${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
  return transcriptPath;
}

describe("sessionsSummaryCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-06T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports aggregated JSON with recent transcript previews", async () => {
    const store = writeStore(
      {
        "+15555550123": {
          sessionId: "summary-direct",
          updatedAt: Date.now() - 5 * 60_000,
          totalTokens: 2000,
          totalTokensFresh: true,
          estimatedCostUsd: 0.0042,
          model: "pi:opus",
        },
        "discord:group:demo": {
          sessionId: "summary-group",
          updatedAt: Date.now() - 2 * 60 * 60_000,
          totalTokens: 4500,
          totalTokensFresh: true,
          estimatedCostUsd: 0.015,
          model: "pi:opus",
        },
        global: {
          sessionId: "summary-global",
          updatedAt: Date.now() - 3 * 24 * 60 * 60_000,
          model: "gpt-5.4",
        },
      },
      "sessions-summary",
    );
    const directTranscript = writeTranscript(store, "summary-direct", [
      { type: "session", version: 1, id: "summary-direct" },
      { message: { role: "user", content: "Investigate flaky tests" } },
      { message: { role: "assistant", content: "I found the race in the session cache." } },
    ]);
    const groupTranscript = writeTranscript(store, "summary-group", [
      { type: "session", version: 1, id: "summary-group" },
      { message: { role: "user", content: "Summarize yesterday's deploy" } },
    ]);

    const { runtime, logs } = makeRuntime();
    try {
      await sessionsSummaryCommand({ store, json: true, recent: "2" }, runtime);
    } finally {
      fs.rmSync(store, { force: true });
      fs.rmSync(directTranscript, { force: true });
      fs.rmSync(groupTranscript, { force: true });
    }

    const payload = JSON.parse(logs[0] ?? "{}") as {
      scannedCount?: number;
      count?: number;
      activity?: { last60m?: number; last24h?: number; last7d?: number };
      totals?: {
        knownTokens?: number;
        sessionsWithKnownTokens?: number;
        estimatedCostUsd?: number;
      };
      models?: Array<{ model?: string; count?: number; knownTokens?: number }>;
      agents?: Array<{ agentId?: string; count?: number }>;
      kinds?: Array<{ kind?: string; count?: number }>;
      recent?: Array<{
        key?: string;
        previewItems?: Array<{ role?: string; text?: string }>;
        firstUserMessage?: string | null;
      }>;
    };

    expect(payload.scannedCount).toBe(3);
    expect(payload.count).toBe(3);
    expect(payload.activity).toEqual({
      last60m: 1,
      last24h: 2,
      last7d: 3,
    });
    expect(payload.totals?.knownTokens).toBe(6500);
    expect(payload.totals?.sessionsWithKnownTokens).toBe(2);
    expect(payload.totals?.estimatedCostUsd).toBeCloseTo(0.0192, 8);
    expect(payload.models?.[0]).toMatchObject({
      model: "pi:opus",
      count: 2,
      knownTokens: 6500,
    });
    expect(payload.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: "main", count: 3 })]),
    );
    expect(payload.kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "direct", count: 1 }),
        expect.objectContaining({ kind: "group", count: 1 }),
        expect.objectContaining({ kind: "global", count: 1 }),
      ]),
    );
    expect(payload.recent?.[0]).toMatchObject({
      key: "+15555550123",
      previewItems: [
        { role: "user", text: "Investigate flaky tests" },
        { role: "assistant", text: "I found the race in the session cache." },
      ],
    });
    expect(payload.recent?.[1]).toMatchObject({
      key: "discord:group:demo",
      previewItems: [{ role: "user", text: "Summarize yesterday's deploy" }],
    });
  });

  it("renders filtered text sections with recent previews", async () => {
    const store = writeStore(
      {
        "+15555550123": {
          sessionId: "summary-direct-filtered",
          updatedAt: Date.now() - 5 * 60_000,
          totalTokens: 2000,
          totalTokensFresh: true,
          model: "pi:opus",
        },
        stale: {
          sessionId: "summary-stale-filtered",
          updatedAt: Date.now() - 2 * 24 * 60 * 60_000,
          model: "pi:opus",
        },
      },
      "sessions-summary-filtered",
    );
    const transcript = writeTranscript(store, "summary-direct-filtered", [
      { message: { role: "user", content: "Look at the auth regression" } },
      { message: { role: "assistant", content: "The OAuth callback lost its state guard." } },
    ]);

    const { runtime, logs } = makeRuntime();
    try {
      await sessionsSummaryCommand({ store, active: "60", recent: "1" }, runtime);
    } finally {
      fs.rmSync(store, { force: true });
      fs.rmSync(transcript, { force: true });
    }

    const text = logs.join("\n");
    expect(text).toContain("Sessions analyzed: 1");
    expect(text).toContain("Filtered from 2 total sessions to last 60 minute(s)");
    expect(text).toContain("Top models");
    expect(text).toContain("Recent sessions");
    expect(text).toContain("+15555550123");
    expect(text).toContain("Look at the auth regression");
  });
});
