import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSubagentGitWorktree, removeSubagentGitWorktree } from "./subagent-worktree.js";

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createCommittedGitRepo(): Promise<{ repoDir: string; workspaceDir: string }> {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-worktree-repo-"));
  const workspaceDir = path.join(repoDir, "packages", "app");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "README.md"), "# app\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "OpenClaw Test"], { cwd: repoDir });
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repoDir });
  return { repoDir, workspaceDir };
}

describe("subagent git worktree helpers", () => {
  let stateDir = "";
  let repoDir = "";

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagent-worktree-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    delete process.env.OPENCLAW_STATE_DIR;
    if (repoDir) {
      await fs.rm(repoDir, { recursive: true, force: true });
      repoDir = "";
    }
    if (stateDir) {
      await fs.rm(stateDir, { recursive: true, force: true });
      stateDir = "";
    }
  });

  it("creates a detached git worktree and preserves the relative workspace path", async () => {
    const repo = await createCommittedGitRepo();
    repoDir = repo.repoDir;

    const prepared = await prepareSubagentGitWorktree({
      agentId: "main",
      childSessionKey: "agent:main:subagent:test-child",
      workspaceDir: repo.workspaceDir,
    });

    expect(prepared.repoDir).toBe(repo.repoDir);
    expect(prepared.worktreeDir).toMatch(
      new RegExp(
        `${path.join(stateDir, "subagent-worktrees", "main").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    expect(prepared.workspaceDir).toBe(path.join(prepared.worktreeDir, "packages", "app"));
    expect(await pathExists(path.join(prepared.workspaceDir, "README.md"))).toBe(true);
    expect(
      execFileSync("git", ["-C", prepared.worktreeDir, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("true");
  });

  it("removes a managed git worktree and prunes it from the repository", async () => {
    const repo = await createCommittedGitRepo();
    repoDir = repo.repoDir;

    const prepared = await prepareSubagentGitWorktree({
      agentId: "main",
      childSessionKey: "agent:main:subagent:test-cleanup",
      workspaceDir: repo.workspaceDir,
    });

    await removeSubagentGitWorktree({
      repoDir: prepared.repoDir,
      worktreeDir: prepared.worktreeDir,
    });

    expect(await pathExists(prepared.worktreeDir)).toBe(false);
    const worktreeList = execFileSync("git", ["-C", repo.repoDir, "worktree", "list"], {
      encoding: "utf8",
    });
    expect(worktreeList).not.toContain(prepared.worktreeDir);
  });

  it("returns an actionable error when the workspace is not inside a git repository", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openclaw-subagent-worktree-non-git-"),
    );
    try {
      await expect(
        prepareSubagentGitWorktree({
          agentId: "main",
          childSessionKey: "agent:main:subagent:test-error",
          workspaceDir,
        }),
      ).rejects.toThrow(/inside a git repository/);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
