import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../templating.js";
import { registerGetReplyCommonMocks } from "./get-reply.test-mocks.js";

const mocks = vi.hoisted(() => ({
  bundledFastpass: vi.fn(async () => ({ handled: false as const })),
  resolveReplyDirectives: vi.fn(),
  initSessionState: vi.fn(),
}));

registerGetReplyCommonMocks();

vi.mock("./bundled-skill-fastpass.runtime.js", () => ({
  tryHandleBundledSkillFastpass: mocks.bundledFastpass,
}));
vi.mock("./commands-core.js", () => ({
  emitResetCommandHooks: vi.fn(async () => undefined),
}));
vi.mock("../../link-understanding/apply.runtime.js", () => ({
  applyLinkUnderstanding: vi.fn(async () => undefined),
}));
vi.mock("../../media-understanding/apply.runtime.js", () => ({
  applyMediaUnderstanding: vi.fn(async () => undefined),
}));
vi.mock("./get-reply-directives.js", () => ({
  resolveReplyDirectives: mocks.resolveReplyDirectives,
}));
vi.mock("./get-reply-inline-actions.js", () => ({
  handleInlineActions: vi.fn(async () => ({ kind: "reply", reply: { text: "ok" } })),
}));
vi.mock("./session.js", () => ({
  initSessionState: mocks.initSessionState,
}));

let getReplyFromConfig: typeof import("./get-reply.js").getReplyFromConfig;

async function loadFreshGetReplyModuleForTest() {
  vi.resetModules();
  ({ getReplyFromConfig } = await import("./get-reply.js"));
}

function buildCtx(overrides: Partial<MsgContext> = {}): MsgContext {
  return {
    Provider: "openclaw-weixin",
    Surface: "openclaw-weixin",
    OriginatingChannel: "openclaw-weixin",
    OriginatingTo: "wx-user-1",
    ChatType: "direct",
    Body: "",
    BodyForAgent: "",
    BodyForCommands: "",
    RawBody: "",
    CommandBody: "",
    SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
    From: "openclaw-weixin:wx-user-1",
    To: "openclaw-weixin:wx-user-1",
    Timestamp: 1710000000000,
    ...overrides,
  };
}

describe("getReplyFromConfig bundled skill fastpass", () => {
  beforeEach(async () => {
    await loadFreshGetReplyModuleForTest();
    delete process.env.OPENCLAW_TEST_FAST;
    mocks.bundledFastpass.mockReset().mockResolvedValue({ handled: false });
    mocks.resolveReplyDirectives
      .mockReset()
      .mockResolvedValue({ kind: "reply", reply: { text: "ok" } });
    mocks.initSessionState.mockReset().mockResolvedValue({
      sessionCtx: {},
      sessionEntry: {},
      previousSessionEntry: {},
      sessionStore: {},
      sessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: "/tmp/sessions.json",
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: false,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
  });

  it("short-circuits before directive/model flow when bundled fastpass handles the message", async () => {
    mocks.bundledFastpass.mockResolvedValueOnce({
      handled: true,
      payload: { text: "✅ 日程已添加" },
      reason: "bundled_skill_fastpass_calendar_add",
    });

    const res = await getReplyFromConfig(
      buildCtx({
        Body: "帮我加个日程，明天下午三点开会",
        BodyForCommands: "帮我加个日程，明天下午三点开会",
        RawBody: "帮我加个日程，明天下午三点开会",
        CommandBody: "帮我加个日程，明天下午三点开会",
      }),
      undefined,
      {},
    );

    expect(res).toEqual({ text: "✅ 日程已添加" });
    expect(mocks.resolveReplyDirectives).not.toHaveBeenCalled();
    expect(mocks.initSessionState).not.toHaveBeenCalled();
  });

  it("injects schedule and file skills into downstream directive resolution", async () => {
    await getReplyFromConfig(
      buildCtx({
        Body: "把这个 pdf 总结一下，再发我未来七天的日程",
        BodyForCommands: "把这个 pdf 总结一下，再发我未来七天的日程",
        RawBody: "把这个 pdf 总结一下，再发我未来七天的日程",
        CommandBody: "把这个 pdf 总结一下，再发我未来七天的日程",
        MediaPath: "/tmp/report.pdf",
        MediaType: "application/pdf",
      }),
      undefined,
      {},
    );

    expect(mocks.bundledFastpass).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          BodyForCommands: "把这个 pdf 总结一下，再发我未来七天的日程",
        }),
        cfg: {},
      }),
    );
    expect(mocks.resolveReplyDirectives).toHaveBeenCalledWith(
      expect.objectContaining({
        skillFilter: expect.arrayContaining(["document-processing-pipeline", "smart-calendar"]),
      }),
    );
  });
});
