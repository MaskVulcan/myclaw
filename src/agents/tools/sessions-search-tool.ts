import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  resolveEffectiveSessionToolsVisibility,
  resolveSessionToolContext,
} from "./sessions-helpers.js";

const SessionsSearchToolSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  maxResults: Type.Optional(Type.Number({ minimum: 1 })),
  maxHitsPerSession: Type.Optional(Type.Number({ minimum: 1 })),
  minScore: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

export function createSessionsSearchTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Session Search",
    name: "sessions_search",
    description:
      "Search indexed session transcripts and review summaries for prior work, then follow up with sessions_history on the matching session when needed.",
    parameters: SessionsSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const maxHitsPerSession = readNumberParam(params, "maxHitsPerSession");
      const minScore = readNumberParam(params, "minScore");
      const { searchSessions } = await import("../../sessions-search/service.js");
      const { cfg, effectiveRequesterKey } = resolveSessionToolContext({
        agentSessionKey: opts?.agentSessionKey,
        sandboxed: opts?.sandboxed,
        config: opts?.config,
      });
      const visibility = resolveEffectiveSessionToolsVisibility({
        cfg,
        sandboxed: opts?.sandboxed === true,
      });
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "search",
        requesterSessionKey: effectiveRequesterKey,
        visibility,
        a2aPolicy: createAgentToAgentPolicy(cfg),
      });
      const result = await searchSessions({
        cfg,
        query,
        agent: resolveAgentIdFromSessionKey(effectiveRequesterKey),
        maxResults,
        maxHitsPerSession,
        minScore,
        requesterSessionKey: effectiveRequesterKey,
        filterSessionKey: (sessionKey) => visibilityGuard.check(sessionKey).allowed,
      });
      return jsonResult(result);
    },
  };
}
