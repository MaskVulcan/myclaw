import fs from "node:fs/promises";
import type { OpenClawConfig } from "../config/config.js";
import { getOrLoadBootstrapFiles } from "./bootstrap-cache.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import {
  buildBootstrapContextFiles,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
} from "./pi-embedded-helpers.js";
import { applyWeixinDmScopedMemoryBootstrap } from "./weixin-dm-scoped-memory.js";
import {
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  DEFAULT_BOOTSTRAP_FILENAME,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

export type BootstrapContextMode = "full" | "lightweight";
export type BootstrapContextRunKind = "default" | "heartbeat" | "cron";
const ESTABLISHED_SESSION_TAIL_BYTES = 64 * 1024;

async function shouldSuppressBootstrapForSession(sessionFile?: string): Promise<boolean> {
  const filePath = sessionFile?.trim();
  if (!filePath) {
    return false;
  }

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    if (stat.size <= 0) {
      return false;
    }

    const bytesToRead = Math.min(stat.size, ESTABLISHED_SESSION_TAIL_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, stat.size - bytesToRead);

    let tail = buffer.toString("utf-8");
    if (bytesToRead < stat.size) {
      const firstNewline = tail.indexOf("\n");
      tail = firstNewline === -1 ? "" : tail.slice(firstNewline + 1);
    }

    if (!tail.includes('"type":"message"') || !tail.includes('"role":"assistant"')) {
      return false;
    }

    return tail
      .split("\n")
      .some((line) => line.includes('"type":"message"') && line.includes('"role":"assistant"'));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

function sanitizeBootstrapFiles(
  files: WorkspaceBootstrapFile[],
  warn?: (message: string) => void,
): WorkspaceBootstrapFile[] {
  const sanitized: WorkspaceBootstrapFile[] = [];
  for (const file of files) {
    const pathValue = typeof file.path === "string" ? file.path.trim() : "";
    if (!pathValue) {
      warn?.(
        `skipping bootstrap file "${file.name}" — missing or invalid "path" field (hook may have used "filePath" instead)`,
      );
      continue;
    }
    sanitized.push({ ...file, path: pathValue });
  }
  return sanitized;
}

function applyContextModeFilter(params: {
  files: WorkspaceBootstrapFile[];
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
}): WorkspaceBootstrapFile[] {
  const contextMode = params.contextMode ?? "full";
  const runKind = params.runKind ?? "default";
  if (contextMode !== "lightweight") {
    return params.files;
  }
  if (runKind === "heartbeat") {
    return params.files.filter((file) => file.name === "HEARTBEAT.md");
  }
  // cron/default lightweight mode keeps bootstrap context empty on purpose.
  return [];
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  agentId?: string;
  warn?: (message: string) => void;
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const rawFiles = params.sessionKey
    ? await getOrLoadBootstrapFiles({
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
      })
    : await loadWorkspaceBootstrapFiles(params.workspaceDir);
  const bootstrapFiles = applyContextModeFilter({
    files: filterBootstrapFilesForSession(rawFiles, sessionKey),
    contextMode: params.contextMode,
    runKind: params.runKind,
  });
  const sessionScopedBootstrapFiles = await applyWeixinDmScopedMemoryBootstrap({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    files: bootstrapFiles,
    warn: params.warn,
  });

  const updated = await applyBootstrapHookOverrides({
    files: sessionScopedBootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
  const sanitized = sanitizeBootstrapFiles(updated, params.warn);
  if (
    sanitized.some((file) => file.name === DEFAULT_BOOTSTRAP_FILENAME) &&
    (await shouldSuppressBootstrapForSession(params.sessionFile))
  ) {
    return sanitized.filter((file) => file.name !== DEFAULT_BOOTSTRAP_FILENAME);
  }
  return sanitized;
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  agentId?: string;
  warn?: (message: string) => void;
  contextMode?: BootstrapContextMode;
  runKind?: BootstrapContextRunKind;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
    warn: params.warn,
  });
  return { bootstrapFiles, contextFiles };
}
