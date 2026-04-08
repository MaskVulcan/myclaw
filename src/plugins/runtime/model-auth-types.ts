import type { ResolvedProviderAuth } from "../../agents/model-auth-runtime-shared.js";

/**
 * Runtime-ready auth result exposed to native plugins.
 *
 * `apiKey` remains optional because some providers resolve through ambient
 * SDK credentials instead of a concrete token (for example AWS SDK auth).
 */
export type ResolvedProviderRuntimeAuth = Omit<ResolvedProviderAuth, "apiKey"> & {
  apiKey?: string;
  baseUrl?: string;
  expiresAt?: number;
};
