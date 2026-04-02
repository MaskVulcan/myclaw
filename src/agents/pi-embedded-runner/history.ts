import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeProviderId } from "../provider-id.js";

const THREAD_SUFFIX_REGEX = /^(.*)(?::(?:thread|topic):\d+)$/i;
const SESSION_KIND_SET = new Set(["dm", "direct", "channel", "group"]);

type HistoryProviderConfig = {
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, { historyLimit?: number }>;
  accounts?: Record<
    string,
    {
      historyLimit?: number;
      dmHistoryLimit?: number;
      dms?: Record<string, { historyLimit?: number }>;
    }
  >;
};

function stripThreadSuffix(value: string): string {
  const match = value.match(THREAD_SUFFIX_REGEX);
  return match?.[1] ?? value;
}

function parseSessionHistoryKey(sessionKey: string): {
  provider: string;
  accountId?: string;
  kind: string;
  userId: string;
} | null {
  const parts = sessionKey.split(":").filter(Boolean);
  const providerParts = parts.length >= 3 && parts[0] === "agent" ? parts.slice(2) : parts;
  const provider = normalizeProviderId(providerParts[0] ?? "");
  if (!provider) {
    return null;
  }

  const directKind = providerParts[1]?.toLowerCase();
  if (directKind && SESSION_KIND_SET.has(directKind)) {
    return {
      provider,
      kind: directKind,
      userId: stripThreadSuffix(providerParts.slice(2).join(":")),
    };
  }

  const accountId = providerParts[1]?.trim();
  const accountScopedKind = providerParts[2]?.toLowerCase();
  if (accountId && accountScopedKind && SESSION_KIND_SET.has(accountScopedKind)) {
    return {
      provider,
      accountId,
      kind: accountScopedKind,
      userId: stripThreadSuffix(providerParts.slice(3).join(":")),
    };
  }

  return null;
}

/**
 * Limits conversation history to the last N user turns (and their associated
 * assistant responses). This reduces token usage for long-running DM sessions.
 */
export function limitHistoryTurns(
  messages: AgentMessage[],
  limit: number | undefined,
): AgentMessage[] {
  if (!limit || limit <= 0 || messages.length === 0) {
    return messages;
  }

  let userCount = 0;
  let lastUserIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount > limit) {
        return messages.slice(lastUserIndex);
      }
      lastUserIndex = i;
    }
  }
  return messages;
}

/**
 * Extract provider + user ID from a session key and look up dmHistoryLimit.
 * Supports per-DM overrides and provider defaults.
 * For channel/group sessions, uses historyLimit from provider config.
 */
export function getHistoryLimitFromSessionKey(
  sessionKey: string | undefined,
  config: OpenClawConfig | undefined,
): number | undefined {
  if (!sessionKey || !config) {
    return undefined;
  }

  const parsed = parseSessionHistoryKey(sessionKey);
  if (!parsed) {
    return undefined;
  }

  const resolveProviderConfig = (
    cfg: OpenClawConfig | undefined,
    providerId: string,
    accountId?: string,
  ): HistoryProviderConfig | undefined => {
    const channels = cfg?.channels;
    if (!channels || typeof channels !== "object") {
      return undefined;
    }
    for (const [configuredProviderId, value] of Object.entries(
      channels as Record<string, unknown>,
    )) {
      if (normalizeProviderId(configuredProviderId) !== providerId) {
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const providerConfig = value as HistoryProviderConfig;
      if (!accountId) {
        return providerConfig;
      }
      const accountConfig = providerConfig.accounts?.[accountId];
      if (!accountConfig || typeof accountConfig !== "object" || Array.isArray(accountConfig)) {
        return providerConfig;
      }
      return {
        ...providerConfig,
        ...accountConfig,
        dms: accountConfig.dms ?? providerConfig.dms,
      };
    }
    return undefined;
  };

  const providerConfig = resolveProviderConfig(config, parsed.provider, parsed.accountId);
  if (!providerConfig) {
    return undefined;
  }

  // For DM sessions: per-DM override -> dmHistoryLimit.
  // Accept both "direct" (new) and "dm" (legacy) for backward compat.
  if (parsed.kind === "dm" || parsed.kind === "direct") {
    if (parsed.userId && providerConfig.dms?.[parsed.userId]?.historyLimit !== undefined) {
      return providerConfig.dms[parsed.userId].historyLimit;
    }
    return providerConfig.dmHistoryLimit;
  }

  // For channel/group sessions: use historyLimit from provider config
  // This prevents context overflow in long-running channel sessions
  if (parsed.kind === "channel" || parsed.kind === "group") {
    return providerConfig.historyLimit;
  }

  return undefined;
}

/**
 * @deprecated Use getHistoryLimitFromSessionKey instead.
 * Alias for backward compatibility.
 */
export const getDmHistoryLimitFromSessionKey = getHistoryLimitFromSessionKey;
