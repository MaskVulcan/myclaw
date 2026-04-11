import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStateDir } from "../config/paths.js";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 15_000;

export const SUBAGENT_WORKTREE_MODES = ["off", "git"] as const;
export type SpawnSubagentWorktreeMode = (typeof SUBAGENT_WORKTREE_MODES)[number];

export type PreparedSubagentGitWorktree = {
  repoDir: string;
  worktreeDir: string;
  workspaceDir: string;
};

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return sanitized.replace(/^-+|-+$/g, "") || "session";
}

function resolveManagedSubagentWorktreesRoot(): string {
  return path.join(resolveStateDir(), "subagent-worktrees");
}

function isPathWithin(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedCandidate.startsWith(rootWithSep);
}

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout ?? "").trim();
}

function summarizeExecError(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

export async function prepareSubagentGitWorktree(params: {
  agentId: string;
  childSessionKey: string;
  workspaceDir: string;
}): Promise<PreparedSubagentGitWorktree> {
  const inheritedWorkspaceDir = params.workspaceDir.trim();
  if (!inheritedWorkspaceDir) {
    throw new Error('worktree="git" requires a resolved child workspace directory.');
  }

  let repoDir = "";
  try {
    repoDir = await runGit(["-C", inheritedWorkspaceDir, "rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(
      `worktree="git" requires the inherited workspace to be inside a git repository (workspace: ${inheritedWorkspaceDir}).`,
    );
  }

  const resolvedRepoDir = path.resolve(repoDir);
  const resolvedWorkspaceDir = path.resolve(inheritedWorkspaceDir);
  const workspaceRelativePath = path.relative(resolvedRepoDir, resolvedWorkspaceDir);
  if (
    workspaceRelativePath.startsWith("..") ||
    path.isAbsolute(workspaceRelativePath) ||
    (!workspaceRelativePath && resolvedWorkspaceDir !== resolvedRepoDir)
  ) {
    throw new Error(
      `worktree="git" could not preserve the inherited workspace path inside repo ${resolvedRepoDir}.`,
    );
  }

  const worktreeDir = path.join(
    resolveManagedSubagentWorktreesRoot(),
    sanitizePathSegment(params.agentId),
    sanitizePathSegment(params.childSessionKey),
  );
  await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.dirname(worktreeDir), { recursive: true, mode: 0o700 });

  try {
    await runGit(["-C", resolvedRepoDir, "worktree", "add", "--detach", worktreeDir, "HEAD"]);
  } catch (err) {
    await removeSubagentGitWorktree({
      repoDir: resolvedRepoDir,
      worktreeDir,
    }).catch(() => {});
    throw new Error(`Failed to create subagent git worktree: ${summarizeExecError(err)}`, {
      cause: err,
    });
  }

  return {
    repoDir: resolvedRepoDir,
    worktreeDir,
    workspaceDir: workspaceRelativePath
      ? path.join(worktreeDir, workspaceRelativePath)
      : worktreeDir,
  };
}

export async function removeSubagentGitWorktree(params: {
  repoDir?: string;
  worktreeDir?: string;
}): Promise<void> {
  const worktreeDir = params.worktreeDir?.trim();
  if (!worktreeDir) {
    return;
  }

  const managedRootDir = resolveManagedSubagentWorktreesRoot();
  const resolvedWorktreeDir = path.resolve(worktreeDir);
  if (
    !isPathWithin(managedRootDir, resolvedWorktreeDir) ||
    resolvedWorktreeDir === managedRootDir
  ) {
    return;
  }

  const repoDir = params.repoDir?.trim();
  if (repoDir) {
    try {
      await runGit(["-C", repoDir, "worktree", "remove", "--force", resolvedWorktreeDir]);
    } catch {
      // Best-effort cleanup only.
    }
    try {
      await runGit(["-C", repoDir, "worktree", "prune"]);
    } catch {
      // Best-effort cleanup only.
    }
  }

  await fs.rm(resolvedWorktreeDir, { recursive: true, force: true }).catch(() => {});
}
