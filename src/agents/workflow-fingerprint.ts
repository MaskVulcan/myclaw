import { createHash } from "node:crypto";
import { normalizeHyphenSlug } from "../shared/string-normalization.js";

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function normalizeWorkflowCommandSignature(command: string): string {
  const tokens = command
    .trim()
    .replace(/^\$\s*/, "")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  const head: string[] = [];
  const pushHead = (value: string | undefined) => {
    const normalized = normalizeToken(value);
    if (normalized) {
      head.push(normalized);
    }
  };

  const first = normalizeToken(tokens[0]);
  pushHead(first);
  if (["pnpm", "npm", "yarn", "bun", "npx"].includes(first)) {
    const second = normalizeToken(tokens[1]);
    pushHead(second);
    if (["exec", "dlx", "run"].includes(second)) {
      pushHead(tokens[2]);
      if (second === "exec") {
        pushHead(tokens[3]);
      }
    } else if (!second.startsWith("-")) {
      pushHead(tokens[2]);
    }
  } else {
    pushHead(tokens[1]);
  }

  const flags = tokens
    .filter((token, index) => index > 0 && token.startsWith("--"))
    .map((token) => token.trim().toLowerCase())
    .slice(0, 2);

  return uniquePreserveOrder([...head, ...flags]).join(" ");
}

export function buildWorkflowFingerprint(params: {
  commands: string[];
  tools: string[];
  suggestedSlug?: string;
}): string | undefined {
  const normalizedCommandSignatures = uniquePreserveOrder(
    params.commands.map((command) => normalizeWorkflowCommandSignature(command)).filter(Boolean),
  );
  const normalizedTools = uniquePreserveOrder(
    params.tools
      .map((toolName) => normalizeHyphenSlug(toolName) ?? normalizeToken(toolName))
      .filter(Boolean),
  )
    .slice(0, 6)
    .toSorted((left, right) => left.localeCompare(right));
  const normalizedSlug = normalizeHyphenSlug(params.suggestedSlug ?? "");
  const primaryCommands = normalizedCommandSignatures
    .slice(0, normalizedSlug ? 1 : 2)
    .filter(Boolean);

  if (primaryCommands.length === 0 && normalizedTools.length === 0 && !normalizedSlug) {
    return undefined;
  }

  const payload = JSON.stringify({
    slug: normalizedSlug || null,
    commands: primaryCommands,
    tools: normalizedTools,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}
