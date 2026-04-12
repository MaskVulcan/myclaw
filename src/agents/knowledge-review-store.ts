import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const KNOWLEDGE_LOOP_ROOT = path.join(".openclaw", "knowledge");
export const KNOWLEDGE_REVIEW_ROOT = path.join(KNOWLEDGE_LOOP_ROOT, "reviews");
export const KNOWLEDGE_REVIEW_NUDGE_ROOT = path.join(KNOWLEDGE_LOOP_ROOT, "review-nudges");

export type KnowledgeReviewUserModelSignals = {
  name?: string;
  preferredAddress?: string;
  pronouns?: string;
  timezone?: string;
  preferences: string[];
  contexts: string[];
  goals: string[];
  notes: string[];
};

export type KnowledgeReviewAutomationSignals = {
  commands: string[];
  tools: string[];
  suggestedTitle?: string;
  suggestedSlug?: string;
  workflowFingerprint?: string;
};

export type KnowledgeReviewRecord = {
  schemaVersion: 1;
  sessionId: string;
  sessionKey: string;
  agentId: string;
  transcriptFile?: string;
  reviewedAt: string;
  title: string;
  firstUserMessage?: string;
  lastMessagePreview?: string;
  summary: string;
  tags: string[];
  previewItems: string[];
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  userModel: KnowledgeReviewUserModelSignals;
  automation: KnowledgeReviewAutomationSignals;
};

export type KnowledgeReviewNudge = {
  schemaVersion: 1;
  sessionId: string;
  sessionKey: string;
  agentId: string;
  transcriptFile?: string;
  firstNudgedAt: string;
  updatedAt: string;
  reasons: string[];
};

function resolveReviewPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT, `${sessionId}.json`);
}

function resolveNudgePath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, KNOWLEDGE_REVIEW_NUDGE_ROOT, `${sessionId}.json`);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function readJsonFileSync<T>(filePath: string): T | null {
  try {
    const content = syncFs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export async function loadKnowledgeReviewRecord(
  workspaceDir: string,
  sessionId: string,
): Promise<KnowledgeReviewRecord | null> {
  return await readJsonFile<KnowledgeReviewRecord>(resolveReviewPath(workspaceDir, sessionId));
}

export function loadKnowledgeReviewRecordSync(
  workspaceDir: string,
  sessionId: string,
): KnowledgeReviewRecord | null {
  return readJsonFileSync<KnowledgeReviewRecord>(resolveReviewPath(workspaceDir, sessionId));
}

export async function writeKnowledgeReviewRecord(params: {
  workspaceDir: string;
  record: KnowledgeReviewRecord;
}): Promise<string> {
  const reviewPath = resolveReviewPath(params.workspaceDir, params.record.sessionId);
  await writeJsonFile(reviewPath, params.record);
  return reviewPath;
}

export async function loadKnowledgeReviewNudge(
  workspaceDir: string,
  sessionId: string,
): Promise<KnowledgeReviewNudge | null> {
  return await readJsonFile<KnowledgeReviewNudge>(resolveNudgePath(workspaceDir, sessionId));
}

export async function writeKnowledgeReviewNudge(params: {
  workspaceDir: string;
  nudge: KnowledgeReviewNudge;
}): Promise<string> {
  const nudgePath = resolveNudgePath(params.workspaceDir, params.nudge.sessionId);
  await writeJsonFile(nudgePath, params.nudge);
  return nudgePath;
}

export async function clearKnowledgeReviewNudge(
  workspaceDir: string,
  sessionId: string,
): Promise<void> {
  try {
    await fs.rm(resolveNudgePath(workspaceDir, sessionId), { force: true });
  } catch {
    // best-effort cleanup
  }
}
