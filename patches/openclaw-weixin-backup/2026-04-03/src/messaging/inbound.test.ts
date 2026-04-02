import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageItemType, type WeixinMessage } from "../api/types.js";
import {
  _resetForTest,
  findAccountIdsByContextToken,
  getContextToken,
  setContextToken,
  weixinMessageToMsgContext,
} from "./inbound.js";

let stateDir: string | undefined;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-weixin-inbound-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
  if (stateDir) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  delete process.env.OPENCLAW_STATE_DIR;
  stateDir = undefined;
});

describe("weixinMessageToMsgContext", () => {
  it("keeps the current turn body separate from quoted context", () => {
    const message: WeixinMessage = {
      from_user_id: "wx-user-1",
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: "现在这个问题" },
          ref_msg: {
            title: "上一条",
            message_item: {
              type: MessageItemType.TEXT,
              text_item: { text: "之前的上下文" },
            },
          },
        },
      ],
    };

    const ctx = weixinMessageToMsgContext(message, "acc-1");

    expect(ctx.Body).toBe("现在这个问题");
    expect(ctx.CommandBody).toBeUndefined();
    expect(ctx.ReplyToBody).toBe("上一条\n之前的上下文");
    expect(ctx.ReplyToIsQuote).toBe(true);
    expect(ctx.SenderId).toBe("wx-user-1");
  });

  it("renders quoted media as a compact placeholder", () => {
    const message: WeixinMessage = {
      from_user_id: "wx-user-2",
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: "帮我看看" },
          ref_msg: {
            message_item: {
              type: MessageItemType.IMAGE,
            },
          },
        },
      ],
    };

    const ctx = weixinMessageToMsgContext(message, "acc-1");

    expect(ctx.Body).toBe("帮我看看");
    expect(ctx.ReplyToBody).toBe("[image]");
    expect(ctx.ReplyToIsQuote).toBe(true);
  });
});

describe("context token restore", () => {
  it("lazy-restores a persisted token on outbound lookup", () => {
    setContextToken("acc-1", "wx-user-1", "ctx-1");

    _resetForTest();

    expect(getContextToken("acc-1", "wx-user-1")).toBe("ctx-1");
  });

  it("can resolve matching account ids after a cold start", () => {
    setContextToken("acc-1", "wx-user-1", "ctx-1");

    _resetForTest();

    expect(findAccountIdsByContextToken(["acc-1", "acc-2"], "wx-user-1")).toEqual(["acc-1"]);
  });
});
