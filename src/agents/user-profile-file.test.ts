import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeKnowledgeReviewRecord } from "./knowledge-review-store.js";
import {
  syncWorkspaceUserProfile,
  USER_PROFILE_END_MARKER,
  USER_PROFILE_START_MARKER,
} from "./user-profile-file.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-user-profile-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("user-profile-file", () => {
  it("aggregates review records into a managed USER.md section", async () => {
    const workspaceDir = await makeWorkspace();
    await fs.writeFile(
      path.join(workspaceDir, "USER.md"),
      "# USER\n\nManual note stays here.\n",
      "utf-8",
    );
    await writeKnowledgeReviewRecord({
      workspaceDir,
      record: {
        schemaVersion: 1,
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        agentId: "main",
        reviewedAt: "2026-04-12T10:00:00.000Z",
        title: "Release Checks",
        summary: "Keep release checks concise.",
        tags: ["release"],
        previewItems: ["Keep release checks concise."],
        messageCount: 2,
        userMessageCount: 1,
        assistantMessageCount: 1,
        userModel: {
          name: "小王",
          timezone: "Asia/Shanghai",
          preferences: ["请用中文回复。"],
          contexts: ["当前项目是 myclaw 知识环重构。"],
          goals: ["目标：把 USER.md 自动建模做好。"],
          notes: ["记住要保留手写内容。"],
        },
        automation: {
          commands: ["openclaw status --json"],
          tools: ["memory_search"],
        },
      },
    });

    const result = await syncWorkspaceUserProfile({ workspaceDir });
    const content = await fs.readFile(path.join(workspaceDir, "USER.md"), "utf-8");

    expect(result.updated).toBe(true);
    expect(content).toContain("Manual note stays here.");
    expect(content).toContain(USER_PROFILE_START_MARKER);
    expect(content).toContain("## Machine-Managed Profile");
    expect(content).toContain("Name: 小王");
    expect(content).toContain("Timezone: Asia/Shanghai");
    expect(content).toContain("请用中文回复。");
    expect(content).toContain("当前项目是 myclaw 知识环重构。");
    expect(content).toContain("目标：把 USER.md 自动建模做好。");
    expect(content).toContain("记住要保留手写内容。");
    expect(content).toContain(USER_PROFILE_END_MARKER);
  });

  it("replaces only the managed block and preserves surrounding content", async () => {
    const workspaceDir = await makeWorkspace();
    await fs.writeFile(
      path.join(workspaceDir, "USER.md"),
      [
        "# USER",
        "",
        "Manual intro",
        "",
        USER_PROFILE_START_MARKER,
        "old",
        USER_PROFILE_END_MARKER,
        "",
        "Manual footer",
        "",
      ].join("\n"),
      "utf-8",
    );
    await writeKnowledgeReviewRecord({
      workspaceDir,
      record: {
        schemaVersion: 1,
        sessionId: "session-2",
        sessionKey: "agent:main:main",
        agentId: "main",
        reviewedAt: "2026-04-12T11:00:00.000Z",
        title: "Session 2",
        summary: "Profile update",
        tags: ["profile"],
        previewItems: ["Use concise updates."],
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        userModel: {
          preferredAddress: "王工",
          preferences: ["保持简洁。"],
          contexts: [],
          goals: [],
          notes: [],
        },
        automation: {
          commands: [],
          tools: [],
        },
      },
    });

    await syncWorkspaceUserProfile({ workspaceDir });
    const content = await fs.readFile(path.join(workspaceDir, "USER.md"), "utf-8");

    expect(content).toContain("Manual intro");
    expect(content).toContain("Manual footer");
    expect(content).not.toContain("\nold\n");
    expect(content.match(new RegExp(USER_PROFILE_START_MARKER, "g"))).toHaveLength(1);
    expect(content).toContain("Preferred Address: 王工");
    expect(content).toContain("保持简洁。");
  });
});
