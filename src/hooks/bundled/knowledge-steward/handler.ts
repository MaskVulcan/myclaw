import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import {
  stewardCurateCommand,
  stewardIngestExplicitSession,
  stewardIncubateSkillsCommand,
  stewardMaintainCommand,
  stewardPromoteSkillsCommand,
} from "../../../commands/steward.js";
import type { OpenClawConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";

const HOOK_KEY = "knowledge-steward";
const DEFAULT_CURATE_LIMIT = 20;
const DEFAULT_INCUBATE_LIMIT = 50;
const DEFAULT_PROMOTE_LIMIT = 50;
const DEFAULT_MIN_CANDIDATES = 2;

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

function createSilentRuntime(): RuntimeEnv {
  return {
    log: () => {},
    error: (value: unknown) => {
      throw new Error(String(value));
    },
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
  };
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
    const runtime = createSilentRuntime();
    const ingest = await stewardIngestExplicitSession({
      sessionKey: event.sessionKey,
      agentId,
      workspaceDir,
      entry: previousSessionEntry,
      apply: true,
    });

    if (ingest.keptSessions === 0) {
      log.debug("knowledge-steward skipped follow-up passes: no durable candidates found", {
        sessionKey: event.sessionKey,
        sessionId: previousSessionEntry.sessionId,
      });
      return;
    }

    await stewardCurateCommand(
      {
        workspace: workspaceDir,
        agent: agentId,
        limit: resolveHookPositiveInt(hookConfig?.curateLimit, DEFAULT_CURATE_LIMIT),
        apply: true,
      },
      runtime,
    );
    await stewardMaintainCommand(
      {
        workspace: workspaceDir,
        agent: agentId,
        apply: true,
      },
      runtime,
    );
    await stewardIncubateSkillsCommand(
      {
        workspace: workspaceDir,
        agent: agentId,
        limit: resolveHookPositiveInt(hookConfig?.incubateLimit, DEFAULT_INCUBATE_LIMIT),
        apply: true,
      },
      runtime,
    );
    await stewardPromoteSkillsCommand(
      {
        workspace: workspaceDir,
        agent: agentId,
        limit: resolveHookPositiveInt(hookConfig?.promoteLimit, DEFAULT_PROMOTE_LIMIT),
        minCandidates: resolveHookPositiveInt(hookConfig?.minCandidates, DEFAULT_MIN_CANDIDATES),
        apply: true,
      },
      runtime,
    );

    log.info("knowledge-steward completed", {
      sessionKey: event.sessionKey,
      sessionId: previousSessionEntry.sessionId,
      workspaceDir,
      memoryCandidates: ingest.memoryCandidates,
      skillCandidates: ingest.skillCandidates,
    });
  } catch (err) {
    log.error("knowledge-steward failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export default runKnowledgeSteward;
