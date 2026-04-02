import { describe, expect, it } from "vitest";

import { classifyWeixinSendFailure } from "./send.js";

describe("classifyWeixinSendFailure", () => {
  it("classifies ret=-2 without context as missing-context", () => {
    const result = classifyWeixinSendFailure({
      message: "sendMessage failed: ret=-2",
      hasContextToken: false,
    });

    expect(result.kind).toBe("missing-context");
    expect(result.error.message).toContain("no contextToken was available");
  });

  it("classifies ret=-2 with context as stale-context", () => {
    const result = classifyWeixinSendFailure({
      message: "sendMessage failed: ret=-2",
      hasContextToken: true,
    });

    expect(result.kind).toBe("stale-context");
    expect(result.error.message).toContain("contextToken was supplied");
  });

  it("classifies ret=-14 as session-expired", () => {
    const result = classifyWeixinSendFailure({
      message: "sendMessage failed: ret=-14",
      hasContextToken: true,
    });

    expect(result.kind).toBe("session-expired");
    expect(result.error.message).toContain("QR re-login is likely required");
  });
});
