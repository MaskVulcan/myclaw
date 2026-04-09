import {
  PROVIDER_AUTH_ENV_VAR_CANDIDATES,
  listKnownProviderAuthEnvVarNames,
} from "../secrets/provider-env-vars.js";

export function resolveProviderEnvApiKeyCandidates(): Record<string, readonly string[]> {
  return PROVIDER_AUTH_ENV_VAR_CANDIDATES;
}

export const PROVIDER_ENV_API_KEY_CANDIDATES = resolveProviderEnvApiKeyCandidates();

export function listKnownProviderEnvApiKeyNames(): string[] {
  return listKnownProviderAuthEnvVarNames();
}
