import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAccountId, parseAgentSessionKey } from "../routing/session-key.js";
import { normalizeProviderId } from "./provider-id.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";
import { DEFAULT_MEMORY_ALT_FILENAME, DEFAULT_MEMORY_FILENAME } from "./workspace.js";

const WEIXIN_PROVIDER_ID = "openclaw-weixin";
const THREAD_SUFFIX_REGEX = /^(.*)(?::(?:thread|topic):\d+)$/i;
const SCOPED_MEMORY_ROOT_SEGMENTS = [".openclaw", "weixin-dm-memory"] as const;
const SHARED_MEMORY_FILE_NAMES = new Set([DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME]);
export const WEIXIN_DM_SCOPED_MEMORY_BOOTSTRAP_NAME = "WEIXIN-DM-MEMORY.md";

type WeixinDirectSessionScope = {
  accountId: string;
  peerId: string;
};

function stripThreadSuffix(value: string): string {
  const match = value.match(THREAD_SUFFIX_REGEX);
  return match?.[1] ?? value;
}

export function parseWeixinDirectSessionScope(
  sessionKey: string | undefined,
): WeixinDirectSessionScope | null {
  const rest = parseAgentSessionKey(sessionKey)?.rest?.trim();
  if (!rest) {
    return null;
  }

  const parts = rest.split(":").filter(Boolean);
  const provider = normalizeProviderId(parts[0] ?? "");
  if (provider !== WEIXIN_PROVIDER_ID) {
    return null;
  }

  const directKind = parts[1]?.toLowerCase();
  if (directKind === "direct" || directKind === "dm") {
    const peerId = stripThreadSuffix(parts.slice(2).join(":")).trim().toLowerCase();
    if (!peerId) {
      return null;
    }
    return {
      accountId: normalizeAccountId(undefined),
      peerId,
    };
  }

  const accountId = parts[1]?.trim();
  const accountScopedKind = parts[2]?.toLowerCase();
  if (!accountId || (accountScopedKind !== "direct" && accountScopedKind !== "dm")) {
    return null;
  }
  const peerId = stripThreadSuffix(parts.slice(3).join(":")).trim().toLowerCase();
  if (!peerId) {
    return null;
  }
  return {
    accountId: normalizeAccountId(accountId),
    peerId,
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim()) || "unknown";
}

function buildScopedMemoryTemplate(scope: WeixinDirectSessionScope): string {
  return [
    "# Weixin DM Scoped Memory",
    "",
    `Channel: ${WEIXIN_PROVIDER_ID}`,
    `Account: ${scope.accountId}`,
    `Peer: ${scope.peerId}`,
    "",
    "Use this file for durable notes, preferences, defaults, and follow-up context that belong only to this one Weixin direct chat.",
    "Keep it concise. Do not store this DM-specific memory in the shared workspace MEMORY.md.",
    "",
    "## Durable Notes",
    "",
  ].join("\n");
}

export function resolveWeixinDmScopedMemoryRelativePath(
  sessionKey: string | undefined,
): string | undefined {
  const scope = parseWeixinDirectSessionScope(sessionKey);
  if (!scope) {
    return undefined;
  }
  return path.join(
    ...SCOPED_MEMORY_ROOT_SEGMENTS,
    encodePathSegment(scope.accountId),
    `${encodePathSegment(scope.peerId)}.md`,
  );
}

export function resolveWeixinDmScopedMemoryPath(params: {
  workspaceDir: string;
  sessionKey?: string;
}): string | undefined {
  const relativePath = resolveWeixinDmScopedMemoryRelativePath(params.sessionKey);
  if (!relativePath) {
    return undefined;
  }
  return path.join(params.workspaceDir, relativePath);
}

async function ensureScopedMemoryFile(params: {
  workspaceDir: string;
  scope: WeixinDirectSessionScope;
}): Promise<WorkspaceBootstrapFile> {
  const targetDir = path.join(
    params.workspaceDir,
    ...SCOPED_MEMORY_ROOT_SEGMENTS,
    encodePathSegment(params.scope.accountId),
  );
  const filePath = path.join(targetDir, `${encodePathSegment(params.scope.peerId)}.md`);
  const template = buildScopedMemoryTemplate(params.scope);

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.writeFile(filePath, template, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
  const existing = await fs.readFile(filePath, "utf-8");
  const content = existing.trim() ? existing : template;
  if (!existing.trim()) {
    await fs.writeFile(filePath, template, { encoding: "utf-8" });
  }

  return {
    name: WEIXIN_DM_SCOPED_MEMORY_BOOTSTRAP_NAME as WorkspaceBootstrapFile["name"],
    path: filePath,
    content,
    missing: false,
  };
}

export async function applyWeixinDmScopedMemoryBootstrap(params: {
  workspaceDir: string;
  sessionKey?: string;
  files: WorkspaceBootstrapFile[];
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  const scope = parseWeixinDirectSessionScope(params.sessionKey);
  if (!scope) {
    return params.files;
  }

  try {
    const scopedFile = await ensureScopedMemoryFile({
      workspaceDir: params.workspaceDir,
      scope,
    });
    return [...params.files.filter((file) => !SHARED_MEMORY_FILE_NAMES.has(file.name)), scopedFile];
  } catch (err) {
    params.warn?.(`failed to prepare Weixin DM scoped memory bootstrap: ${String(err)}`);
    return params.files;
  }
}
