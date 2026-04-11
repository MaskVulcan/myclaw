import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import {
  DEFAULT_MEMORY_STEWARD_CURATE_LIMIT,
  DEFAULT_MEMORY_STEWARD_INCUBATE_LIMIT,
  DEFAULT_MEMORY_STEWARD_MIN_CANDIDATES,
  DEFAULT_MEMORY_STEWARD_PROMOTE_LIMIT,
  resolveDefaultMemoryProviderKernel,
} from "../../../agents/memory-provider-kernel.js";
import type { OpenClawConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";

const HOOK_KEY = "knowledge-steward";

const log = createSubsystemLogger("hooks/knowledge-steward");

function resolveHookPositiveInt(raw: unknown, fallback: number): string {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  return String(fallback);
}

const runKnowledgeSteward: HookHandler = async (event) => {
  if (event.type !== "command" || (event.action !== "new" && event.action !== "reset")) {
    return;
  }

  try {
    const cfg = event.context.cfg as OpenClawConfig | undefined;
    const previousSessionEntry = event.context.previousSessionEntry as SessionEntry | undefined;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir =
      typeof event.context.workspaceDir === "string" && event.context.workspaceDir.trim()
        ? event.context.workspaceDir.trim()
        : cfg
          ? resolveAgentWorkspaceDir(cfg, agentId)
          : "";

    if (!cfg || !workspaceDir || !previousSessionEntry?.sessionId) {
      log.debug("knowledge-steward skipped: missing config/workspace/previous session", {
        hasConfig: Boolean(cfg),
        workspaceDir,
        hasPreviousSession: Boolean(previousSessionEntry?.sessionId),
      });
      return;
    }

    const hookConfig = resolveHookConfig(cfg, HOOK_KEY);
    const result = await resolveDefaultMemoryProviderKernel().runSessionStewardCycle({
      sessionKey: event.sessionKey,
      agentId,
      workspaceDir,
      entry: previousSessionEntry,
      curateLimit: resolveHookPositiveInt(
        hookConfig?.curateLimit,
        DEFAULT_MEMORY_STEWARD_CURATE_LIMIT,
      ),
      incubateLimit: resolveHookPositiveInt(
        hookConfig?.incubateLimit,
        DEFAULT_MEMORY_STEWARD_INCUBATE_LIMIT,
      ),
      promoteLimit: resolveHookPositiveInt(
        hookConfig?.promoteLimit,
        DEFAULT_MEMORY_STEWARD_PROMOTE_LIMIT,
      ),
      minCandidates: resolveHookPositiveInt(
        hookConfig?.minCandidates,
        DEFAULT_MEMORY_STEWARD_MIN_CANDIDATES,
      ),
    });

    if (result.keptSessions === 0) {
      log.debug("knowledge-steward skipped follow-up passes: no durable candidates found", {
        sessionKey: event.sessionKey,
        sessionId: previousSessionEntry.sessionId,
      });
      return;
    }

    log.info("knowledge-steward completed", {
      sessionKey: event.sessionKey,
      sessionId: previousSessionEntry.sessionId,
      workspaceDir,
      memoryCandidates: result.memoryCandidates,
      skillCandidates: result.skillCandidates,
    });
  } catch (err) {
    log.error("knowledge-steward failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export default runKnowledgeSteward;
