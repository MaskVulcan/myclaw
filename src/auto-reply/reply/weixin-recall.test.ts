import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWeixinTranscriptRecall } from "./weixin-recall.js";

const tempDirs: string[] = [];

async function writeTranscript(messages: Array<{ role: "user" | "assistant"; text: string }>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-weixin-recall-"));
  tempDirs.push(dir);
  const transcriptPath = path.join(dir, "sess-weixin.jsonl");
  const lines = messages.map((message, index) =>
    JSON.stringify({
      id: `msg-${index + 1}`,
      message: {
        role: message.role,
        content: [{ type: "text", text: message.text }],
      },
    }),
  );
  await fs.writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf-8");
  return { transcriptPath, sessionId: "sess-weixin" };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("buildWeixinTranscriptRecall", () => {
  it("recalls older same-chat snippets outside the active DM history window", async () => {
    const { transcriptPath, sessionId } = await writeTranscript([
      { role: "user", text: "上次部署时 API 端口改成了 19090" },
      { role: "assistant", text: "记住了，旧环境 API 端口是 19090。" },
      { role: "user", text: "这两天先别动日志采集" },
      { role: "assistant", text: "好的，日志采集配置先保持不变。" },
      { role: "user", text: "今早我们主要在看内存波动" },
      { role: "assistant", text: "我先盯内存，不动端口。" },
      { role: "user", text: "刚才那个慢回复问题先观察" },
      { role: "assistant", text: "收到，先不改模型。" },
    ]);

    const block = buildWeixinTranscriptRecall({
      sessionCtx: {
        Provider: "openclaw-weixin",
        ChatType: "direct",
        SessionId: sessionId,
      },
      cfg: {
        channels: {
          "openclaw-weixin": {
            dmHistoryLimit: 2,
          },
        },
      },
      sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      sessionId,
      sessionFile: transcriptPath,
      currentBody: "API 端口现在是多少",
    } as never);

    expect(block).toContain("19090");
    expect(block).toContain("same Weixin DM transcript recall");
    expect(block).not.toContain("刚才那个慢回复问题先观察");
    expect(block).not.toContain("我先盯内存，不动端口。");
  });

  it("falls back to reply context when current body is too generic", async () => {
    const { transcriptPath, sessionId } = await writeTranscript([
      { role: "user", text: "上次你说回滚命令是 kubectl rollout undo deploy/api" },
      { role: "assistant", text: "对，回滚命令就是 kubectl rollout undo deploy/api" },
      { role: "user", text: "最近先别执行" },
      { role: "assistant", text: "收到，先观察。" },
      { role: "user", text: "今天主要看日志" },
      { role: "assistant", text: "好，我先看日志。" },
    ]);

    const block = buildWeixinTranscriptRecall({
      sessionCtx: {
        Provider: "openclaw-weixin",
        ChatType: "direct",
        SessionId: sessionId,
        ReplyToBody: "kubectl rollout undo deploy/api",
      },
      cfg: {
        channels: {
          "openclaw-weixin": {
            dmHistoryLimit: 1,
          },
        },
      },
      sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      sessionId,
      sessionFile: transcriptPath,
      currentBody: "这个呢",
    } as never);

    expect(block).toContain("kubectl rollout undo deploy/api");
  });

  it("skips non-Weixin or non-direct sessions", async () => {
    const { transcriptPath, sessionId } = await writeTranscript([
      { role: "user", text: "端口 19090" },
      { role: "assistant", text: "收到" },
    ]);

    expect(
      buildWeixinTranscriptRecall({
        sessionCtx: {
          Provider: "telegram",
          ChatType: "direct",
          SessionId: sessionId,
        },
        cfg: {
          channels: {
            telegram: {
              dmHistoryLimit: 2,
            },
          },
        },
        sessionKey: "agent:main:telegram:direct:user-1",
        sessionId,
        sessionFile: transcriptPath,
        currentBody: "端口是多少",
      } as never),
    ).toBeUndefined();

    expect(
      buildWeixinTranscriptRecall({
        sessionCtx: {
          Provider: "openclaw-weixin",
          ChatType: "group",
          SessionId: sessionId,
        },
        cfg: {
          channels: {
            "openclaw-weixin": {
              dmHistoryLimit: 2,
            },
          },
        },
        sessionKey: "agent:main:openclaw-weixin:primary:group:wx-room-1",
        sessionId,
        sessionFile: transcriptPath,
        currentBody: "端口是多少",
      } as never),
    ).toBeUndefined();
  });
});
