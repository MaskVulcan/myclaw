import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import { resolveDefaultKnowledgeReviewKernel } from "../../../agents/knowledge-review-kernel.js";
import {
  DEFAULT_MEMORY_STEWARD_CURATE_LIMIT,
  DEFAULT_MEMORY_STEWARD_INCUBATE_LIMIT,
  DEFAULT_MEMORY_STEWARD_MIN_CANDIDATES,
  DEFAULT_MEMORY_STEWARD_PROMOTE_LIMIT,
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

function resolveWorkspaceDir(params: {
  cfg?: OpenClawConfig;
  eventWorkspaceDir: unknown;
  agentId: string;
}): string {
  if (typeof params.eventWorkspaceDir === "string" && params.eventWorkspaceDir.trim()) {
    return params.eventWorkspaceDir.trim();
  }
  if (params.cfg) {
    return resolveAgentWorkspaceDir(params.cfg, params.agentId);
  }
  return "";
}

function resolveEventAgentId(sessionKey: string, contextAgentId: unknown): string {
  if (typeof contextAgentId === "string" && contextAgentId.trim()) {
    return contextAgentId.trim();
  }
  return resolveAgentIdFromSessionKey(sessionKey);
}

const runKnowledgeSteward: HookHandler = async (event) => {
  const isSessionEndCommand =
    event.type === "command" && (event.action === "new" || event.action === "reset");
  const isCompactionReviewNudge = event.type === "session" && event.action === "compact:after";

  if (!isSessionEndCommand && !isCompactionReviewNudge) {
    return;
  }

  try {
    const cfg = event.context.cfg as OpenClawConfig | undefined;
    const agentId = resolveEventAgentId(event.sessionKey, event.context.agentId);
    const workspaceDir = resolveWorkspaceDir({
      cfg,
      eventWorkspaceDir: event.context.workspaceDir,
      agentId,
    });

    if (!workspaceDir) {
      log.debug("knowledge-steward skipped: missing workspace", {
        sessionKey: event.sessionKey,
        action: `${event.type}:${event.action}`,
      });
      return;
    }

    if (isCompactionReviewNudge) {
      const sessionId =
        typeof event.context.sessionId === "string" ? event.context.sessionId.trim() : "";
      const transcriptFile =
        typeof event.context.sessionFile === "string" && event.context.sessionFile.trim()
          ? event.context.sessionFile.trim()
          : undefined;
      if (!sessionId) {
        log.debug("knowledge-steward compact nudge skipped: missing sessionId", {
          sessionKey: event.sessionKey,
        });
        return;
      }

      const result = await resolveDefaultKnowledgeReviewKernel().nudgeSession({
        workspaceDir,
        agentId,
        sessionKey: event.sessionKey,
        sessionId,
        ...(transcriptFile ? { transcriptFile } : {}),
        reason: "session:compact:after",
      });

      log.debug("knowledge-steward compact review nudged", {
        sessionKey: event.sessionKey,
        sessionId,
        workspaceDir,
        nudgePath: result.nudgePath,
        reasons: result.nudge.reasons,
      });
      return;
    }

    const previousSessionEntry = event.context.previousSessionEntry as SessionEntry | undefined;
    if (!previousSessionEntry?.sessionId) {
      log.debug("knowledge-steward skipped: missing previous session", {
        workspaceDir,
        sessionKey: event.sessionKey,
      });
      return;
    }

    const hookConfig = cfg ? resolveHookConfig(cfg, HOOK_KEY) : undefined;
    const result = await resolveDefaultKnowledgeReviewKernel().runSessionEndCycle({
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

    if (!result) {
      log.debug("knowledge-steward skipped: review produced no durable transcript summary", {
        sessionKey: event.sessionKey,
        sessionId: previousSessionEntry.sessionId,
      });
      return;
    }

    if (result.steward.keptSessions === 0) {
      log.debug("knowledge-steward skipped follow-up passes: no durable candidates found", {
        sessionKey: event.sessionKey,
        sessionId: previousSessionEntry.sessionId,
        reviewPath: result.recordPath,
      });
      return;
    }

    log.info("knowledge-steward completed", {
      sessionKey: event.sessionKey,
      sessionId: previousSessionEntry.sessionId,
      workspaceDir,
      reviewPath: result.recordPath,
      memoryCandidates: result.steward.memoryCandidates,
      skillCandidates: result.steward.skillCandidates,
    });
  } catch (err) {
    log.error("knowledge-steward failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export default runKnowledgeSteward;
