import type { Skill } from "@mariozechner/pi-coding-agent";
import JSON5 from "json5";
import { validateRegistryNpmSpec } from "../../infra/npm-registry-spec.js";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import {
  applyOpenClawManifestInstallCommonFields,
  getFrontmatterString,
  normalizeStringList,
  parseOpenClawManifestInstallBase,
  parseFrontmatterBool,
  resolveOpenClawManifestBlock,
  resolveOpenClawManifestInstall,
  resolveOpenClawManifestOs,
  resolveOpenClawManifestRequires,
} from "../../shared/frontmatter.js";
import type {
  OpenClawSkillMetadata,
  ParsedSkillFrontmatter,
  SkillEntry,
  SkillInstallSpec,
  SkillInvocationPolicy,
} from "./types.js";

export type SkillLightweightPrompt = {
  summary?: string;
  usage?: string;
};

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
const GO_MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;

function normalizeSafeBrewFormula(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const formula = raw.trim();
  if (!formula || formula.startsWith("-") || formula.includes("\\") || formula.includes("..")) {
    return undefined;
  }
  if (!BREW_FORMULA_PATTERN.test(formula)) {
    return undefined;
  }
  return formula;
}

function normalizeSafeNpmSpec(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const spec = raw.trim();
  if (!spec || spec.startsWith("-")) {
    return undefined;
  }
  if (validateRegistryNpmSpec(spec) !== null) {
    return undefined;
  }
  return spec;
}

function normalizeSafeGoModule(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const moduleSpec = raw.trim();
  if (
    !moduleSpec ||
    moduleSpec.startsWith("-") ||
    moduleSpec.includes("\\") ||
    moduleSpec.includes("://")
  ) {
    return undefined;
  }
  if (!GO_MODULE_PATTERN.test(moduleSpec)) {
    return undefined;
  }
  return moduleSpec;
}

function normalizeSafeUvPackage(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const pkg = raw.trim();
  if (!pkg || pkg.startsWith("-") || pkg.includes("\\") || pkg.includes("://")) {
    return undefined;
  }
  if (!UV_PACKAGE_PATTERN.test(pkg)) {
    return undefined;
  }
  return pkg;
}

function normalizeSafeDownloadUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  if (!value || /\s/.test(value)) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  const parsed = parseOpenClawManifestInstallBase(input, ["brew", "node", "go", "uv", "download"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec = applyOpenClawManifestInstallCommonFields<SkillInstallSpec>(
    {
      kind: parsed.kind as SkillInstallSpec["kind"],
    },
    parsed,
  );
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  const formula = normalizeSafeBrewFormula(raw.formula);
  if (formula) {
    spec.formula = formula;
  }
  const cask = normalizeSafeBrewFormula(raw.cask);
  if (!spec.formula && cask) {
    spec.formula = cask;
  }
  if (spec.kind === "node") {
    const pkg = normalizeSafeNpmSpec(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  } else if (spec.kind === "uv") {
    const pkg = normalizeSafeUvPackage(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  }
  const moduleSpec = normalizeSafeGoModule(raw.module);
  if (moduleSpec) {
    spec.module = moduleSpec;
  }
  const downloadUrl = normalizeSafeDownloadUrl(raw.url);
  if (downloadUrl) {
    spec.url = downloadUrl;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }

  if (spec.kind === "brew" && !spec.formula) {
    return undefined;
  }
  if (spec.kind === "node" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "go" && !spec.module) {
    return undefined;
  }
  if (spec.kind === "uv" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "download" && !spec.url) {
    return undefined;
  }

  return spec;
}

function parseFrontmatterStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(value);
  }
  if (typeof value !== "string") {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      return normalizeStringList(JSON5.parse(trimmed));
    } catch {
      return normalizeStringList(trimmed);
    }
  }
  return normalizeStringList(trimmed);
}

function normalizeCapabilityIds(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(normalized)) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function resolveOpenClawMetadata(
  frontmatter: ParsedSkillFrontmatter,
): OpenClawSkillMetadata | undefined {
  const metadataObj = resolveOpenClawManifestBlock({ frontmatter });
  const frontmatterCapabilities = normalizeCapabilityIds(
    parseFrontmatterStringList(frontmatter.capabilities),
  );
  const metadataCapabilities = normalizeCapabilityIds(
    parseFrontmatterStringList(metadataObj?.capabilities),
  );
  const capabilitySummary =
    getFrontmatterString(frontmatter, "capability-summary") ??
    (typeof metadataObj?.capabilitySummary === "string"
      ? metadataObj.capabilitySummary
      : undefined);
  const progressiveDisclosureRaw =
    getFrontmatterString(frontmatter, "progressive-disclosure") ??
    (typeof metadataObj?.progressiveDisclosure === "string"
      ? metadataObj.progressiveDisclosure
      : undefined);
  const progressiveDisclosure =
    progressiveDisclosureRaw?.trim().toLowerCase() === "capabilities-first"
      ? "capabilities-first"
      : progressiveDisclosureRaw?.trim().toLowerCase() === "full"
        ? "full"
        : undefined;
  if (
    !metadataObj &&
    frontmatterCapabilities.length === 0 &&
    !capabilitySummary?.trim() &&
    !progressiveDisclosure
  ) {
    return undefined;
  }
  const source = metadataObj ?? {};
  const requires = resolveOpenClawManifestRequires(source);
  const install = resolveOpenClawManifestInstall(source, parseInstallSpec);
  const osRaw = resolveOpenClawManifestOs(source);
  return {
    always: typeof source.always === "boolean" ? source.always : undefined,
    emoji: typeof source.emoji === "string" ? source.emoji : undefined,
    homepage: typeof source.homepage === "string" ? source.homepage : undefined,
    skillKey: typeof source.skillKey === "string" ? source.skillKey : undefined,
    primaryEnv: typeof source.primaryEnv === "string" ? source.primaryEnv : undefined,
    capabilities:
      metadataCapabilities.length > 0
        ? metadataCapabilities
        : frontmatterCapabilities.length > 0
          ? frontmatterCapabilities
          : undefined,
    capabilitySummary: capabilitySummary?.trim() || undefined,
    progressiveDisclosure,
    os: osRaw.length > 0 ? osRaw : undefined,
    requires: requires,
    install: install.length > 0 ? install : undefined,
  };
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterString(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterString(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

function normalizeSkillLightweightText(
  value: string | undefined,
  baseDir?: string,
): string | undefined {
  const trimmed = value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!trimmed) {
    return undefined;
  }
  if (!baseDir) {
    return trimmed;
  }
  return trimmed.replaceAll("{baseDir}", baseDir);
}

export function resolveSkillLightweightPrompt(
  frontmatter: ParsedSkillFrontmatter,
  params?: { baseDir?: string },
): SkillLightweightPrompt | undefined {
  const summary = normalizeSkillLightweightText(
    getFrontmatterString(frontmatter, "lightweight-summary"),
    params?.baseDir,
  );
  const usage = normalizeSkillLightweightText(
    getFrontmatterString(frontmatter, "lightweight-usage"),
    params?.baseDir,
  );
  if (!summary && !usage) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
