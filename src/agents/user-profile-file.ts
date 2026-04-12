import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  KNOWLEDGE_REVIEW_ROOT,
  loadKnowledgeReviewRecordSync,
  type KnowledgeReviewRecord,
} from "./knowledge-review-store.js";
import { DEFAULT_USER_FILENAME } from "./workspace.js";

export const USER_PROFILE_START_MARKER = "<!-- openclaw:user-profile:start -->";
export const USER_PROFILE_END_MARKER = "<!-- openclaw:user-profile:end -->";

type AggregatedUserProfile = {
  reviewedAt?: string;
  reviewedSessions: number;
  name?: string;
  preferredAddress?: string;
  pronouns?: string;
  timezone?: string;
  preferences: string[];
  contexts: string[];
  goals: string[];
  notes: string[];
};

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

function collectWorkspaceReviewRecords(workspaceDir: string): KnowledgeReviewRecord[] {
  const reviewDir = path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT);
  if (!fs.existsSync(reviewDir)) {
    return [];
  }
  const reviewFiles = fs
    .readdirSync(reviewDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.basename(entry.name, ".json"));
  const records = reviewFiles
    .map((sessionId) => loadKnowledgeReviewRecordSync(workspaceDir, sessionId))
    .filter((record): record is KnowledgeReviewRecord => Boolean(record));
  return records.toSorted(
    (left, right) =>
      Date.parse(right.reviewedAt || "0") - Date.parse(left.reviewedAt || "0") ||
      left.sessionId.localeCompare(right.sessionId),
  );
}

function aggregateUserProfile(records: KnowledgeReviewRecord[]): AggregatedUserProfile | null {
  if (records.length === 0) {
    return null;
  }

  const preferences = uniquePreserveOrder(
    records.flatMap((record) => record.userModel.preferences),
  ).slice(0, 8);
  const contexts = uniquePreserveOrder(
    records.flatMap((record) => record.userModel.contexts),
  ).slice(0, 8);
  const goals = uniquePreserveOrder(records.flatMap((record) => record.userModel.goals)).slice(
    0,
    8,
  );
  const notes = uniquePreserveOrder(records.flatMap((record) => record.userModel.notes)).slice(
    0,
    8,
  );
  const latestWith = (selector: (record: KnowledgeReviewRecord) => string | undefined) =>
    records
      .map(selector)
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  const profile: AggregatedUserProfile = {
    reviewedAt: records[0]?.reviewedAt,
    reviewedSessions: records.length,
    ...(latestWith((record) => record.userModel.name)
      ? { name: latestWith((record) => record.userModel.name) }
      : {}),
    ...(latestWith((record) => record.userModel.preferredAddress)
      ? { preferredAddress: latestWith((record) => record.userModel.preferredAddress) }
      : {}),
    ...(latestWith((record) => record.userModel.pronouns)
      ? { pronouns: latestWith((record) => record.userModel.pronouns) }
      : {}),
    ...(latestWith((record) => record.userModel.timezone)
      ? { timezone: latestWith((record) => record.userModel.timezone) }
      : {}),
    preferences,
    contexts,
    goals,
    notes,
  };

  const hasAnySignals =
    Boolean(profile.name) ||
    Boolean(profile.preferredAddress) ||
    Boolean(profile.pronouns) ||
    Boolean(profile.timezone) ||
    preferences.length > 0 ||
    contexts.length > 0 ||
    goals.length > 0 ||
    notes.length > 0;
  return hasAnySignals ? profile : null;
}

function renderBulletSection(title: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [`### ${title}`, ...items.map((item) => `- ${item}`), ""];
}

function buildManagedUserProfileSection(profile: AggregatedUserProfile): string {
  const identityLines = [
    profile.name ? `- Name: ${profile.name}` : null,
    profile.preferredAddress ? `- Preferred Address: ${profile.preferredAddress}` : null,
    profile.pronouns ? `- Pronouns: ${profile.pronouns}` : null,
    profile.timezone ? `- Timezone: ${profile.timezone}` : null,
  ].filter((line): line is string => Boolean(line));

  const lines = [
    USER_PROFILE_START_MARKER,
    "## Machine-Managed Profile",
    "",
    "Updated automatically from knowledge review records. Edit outside this block for manual notes.",
    ...(profile.reviewedAt ? [`Last Reviewed At: ${profile.reviewedAt}`] : []),
    `Reviewed Sessions: ${profile.reviewedSessions}`,
    "",
    ...renderBulletSection("Identity", identityLines),
    ...renderBulletSection("Preferences", profile.preferences),
    ...renderBulletSection("Contexts", profile.contexts),
    ...renderBulletSection("Goals", profile.goals),
    ...renderBulletSection("Notes", profile.notes),
    USER_PROFILE_END_MARKER,
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function upsertManagedUserProfile(existingContent: string | null, managedSection: string): string {
  const existing = existingContent ?? "";
  const startIndex = existing.indexOf(USER_PROFILE_START_MARKER);
  const endIndex = existing.indexOf(USER_PROFILE_END_MARKER);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + USER_PROFILE_END_MARKER.length).trimStart();
    const parts = [before, managedSection.trimEnd(), after].filter((part) => part.length > 0);
    return `${parts.join("\n\n").trimEnd()}\n`;
  }

  const prefix = existing.trim().length > 0 ? existing.trimEnd() : "# USER";
  return `${prefix}\n\n${managedSection}`;
}

export async function syncWorkspaceUserProfile(params: {
  workspaceDir: string;
}): Promise<{ path: string; updated: boolean; skipped: boolean }> {
  const records = collectWorkspaceReviewRecords(params.workspaceDir);
  const profile = aggregateUserProfile(records);
  const userPath = path.join(params.workspaceDir, DEFAULT_USER_FILENAME);
  if (!profile) {
    return { path: userPath, updated: false, skipped: true };
  }

  const managedSection = buildManagedUserProfileSection(profile);
  const existingContent = await fsp.readFile(userPath, "utf-8").catch(() => null);
  const nextContent = upsertManagedUserProfile(existingContent, managedSection);
  if (existingContent === nextContent) {
    return { path: userPath, updated: false, skipped: false };
  }

  await fsp.mkdir(path.dirname(userPath), { recursive: true });
  await fsp.writeFile(userPath, nextContent, "utf-8");
  return { path: userPath, updated: true, skipped: false };
}
