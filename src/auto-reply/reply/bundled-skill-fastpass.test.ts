import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveWeixinCalendarHome,
  tryHandleBundledSkillFastpass,
} from "./bundled-skill-fastpass.js";
import { buildTestCtx } from "./test-ctx.js";

describe("bundled skill fastpass", () => {
  it("derives an isolated calendar home from the Weixin direct session scope", () => {
    const ctx = buildTestCtx({
      Provider: "openclaw-weixin",
      Surface: "openclaw-weixin",
      OriginatingChannel: "openclaw-weixin",
      ChatType: "direct",
      SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
    });

    expect(
      resolveWeixinCalendarHome({
        ctx,
        stateDir: "/tmp/openclaw-state",
      }),
    ).toBe("/tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1");
  });

  it("fast-passes Weixin schedule add messages into the bundled calendar CLI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T09:00:00+08:00"));
    try {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-fastpass-add-"));
      const cronStorePath = path.join(stateDir, "cron", "jobs.json");
      const execFile = vi.fn(async () => ({
        code: 0,
        stdout:
          "Looking in indexes: http://mirror.example/simple\nRequirement already satisfied\n\n✅ 日程已添加:\n   🤝 开会讨论Q1进度\n   📆 4月2日 周四 15:00\n   👥 张总\n",
        stderr: "",
      }));
      const ctx = buildTestCtx({
        Provider: "openclaw-weixin",
        Surface: "openclaw-weixin",
        OriginatingChannel: "openclaw-weixin",
        OriginatingTo: "wx-user-1",
        SenderId: "wx-user-1",
        SenderName: "张三",
        ChatType: "direct",
        SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        BodyForCommands: "帮我加个日程，明天下午3点和张总在3楼会议室开会讨论Q1进度，备注：带上合同",
        MediaPath: "/tmp/contract.pdf",
        MediaType: "application/pdf",
      });

      const result = await tryHandleBundledSkillFastpass(
        { ctx },
        {
          execFile,
          stateDir,
          env: { OPENCLAW_STATE_DIR: stateDir },
          calendarScriptPath: "/tmp/fake-sc",
          cronStorePath,
        },
      );

      expect(result).toEqual({
        handled: true,
        payload: {
          text: "✅ 日程已添加:\n   🤝 开会讨论Q1进度\n   📆 4月2日 周四 15:00\n   👥 张总",
        },
        reason: "bundled_skill_fastpass_calendar_add",
      });

      const call = execFile.mock.calls[0];
      expect(call?.[0]).toBe("bash");
      expect(call?.[1]).toEqual([
        "/tmp/fake-sc",
        "add",
        "--date",
        "2026-04-02",
        "--time",
        "15:00",
        "--title",
        "开会讨论Q1进度",
        "--category",
        "会议",
        "--with",
        "张总",
        "--location",
        "3楼会议室",
        "--notes",
        "带上合同\n\n会议文件:\n- contract.pdf (application/pdf)",
        "明天下午3点和张总在3楼会议室开会讨论Q1进度，备注：带上合同",
      ]);
      expect(call?.[2]).toMatchObject({
        env: expect.objectContaining({
          SMART_CALENDAR_HOME: path.join(
            stateDir,
            "skills-data",
            "smart-calendar",
            "weixin-dm",
            "primary",
            "wx-user-1",
          ),
        }),
      });

      const metadata = JSON.parse(
        await fs.readFile(
          path.join(
            stateDir,
            "skills-data",
            "smart-calendar",
            "weixin-dm",
            "primary",
            "wx-user-1",
            ".openclaw-weixin-route.json",
          ),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(metadata.channel).toBe("openclaw-weixin");
      expect(metadata.to).toBe("wx-user-1");
      expect(metadata.senderId).toBe("wx-user-1");

      const cronStore = JSON.parse(await fs.readFile(cronStorePath, "utf8")) as {
        jobs?: Array<{ name?: string; payload?: { text?: string } }>;
      };
      expect(cronStore.jobs?.map((job) => job.name)).toEqual([
        "openclaw:smart-calendar:weixin-digest:primary:wx-user-1:today-0900",
        "openclaw:smart-calendar:weixin-digest:primary:wx-user-1:tomorrow-2200",
      ]);
      expect(cronStore.jobs?.map((job) => job.payload?.text)).toEqual([
        "发我今天的日程，文字总结版和日历图片都要",
        "发我明天的日程，文字总结版和日历图片都要",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("extracts grounded meeting links, content, and files into notes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T09:00:00+08:00"));
    try {
      const execFile = vi.fn(async () => ({
        code: 0,
        stdout: "✅ 日程已添加",
        stderr: "",
      }));
      const ctx = buildTestCtx({
        Provider: "openclaw-weixin",
        Surface: "openclaw-weixin",
        OriginatingChannel: "openclaw-weixin",
        OriginatingTo: "wx-user-1",
        SenderId: "wx-user-1",
        ChatType: "direct",
        SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        BodyForCommands:
          "帮我加个日程，明天下午3点和张总在腾讯会议开会讨论Q1进度，会议链接：https://meeting.example/q1，会议内容：过一遍预算和方案，会议文件：Q1预算表.xlsx，备注：带上合同",
        MediaPath: "/tmp/meeting-deck.pdf",
        MediaType: "application/pdf",
      });

      await tryHandleBundledSkillFastpass(
        { ctx },
        {
          execFile,
          stateDir: "/tmp/openclaw-state",
          env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
          calendarScriptPath: "/tmp/fake-sc",
          cronStorePath: "/tmp/openclaw-state/cron/jobs.json",
        },
      );

      expect(execFile.mock.calls[0]?.[1]).toEqual([
        "/tmp/fake-sc",
        "add",
        "--date",
        "2026-04-02",
        "--time",
        "15:00",
        "--title",
        "开会讨论Q1进度",
        "--category",
        "会议",
        "--with",
        "张总",
        "--location",
        "腾讯会议",
        "--notes",
        [
          "带上合同",
          "会议内容: 过一遍预算和方案",
          "会议链接:\n- https://meeting.example/q1",
          "会议文件:\n- meeting-deck.pdf (application/pdf)\n- Q1预算表.xlsx",
        ].join("\n\n"),
        "明天下午3点和张总在腾讯会议开会讨论Q1进度，会议链接：https://meeting.example/q1，会议内容：过一遍预算和方案，会议文件：Q1预算表.xlsx，备注：带上合同",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes chinese time and travel location for the user's Weixin add message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T15:30:00+08:00"));
    try {
      const execFile = vi.fn(async () => ({
        code: 0,
        stdout: "✅ 日程已添加",
        stderr: "",
      }));
      const ctx = buildTestCtx({
        Provider: "openclaw-weixin",
        Surface: "openclaw-weixin",
        OriginatingChannel: "openclaw-weixin",
        OriginatingTo: "o9cq80xlx0ztnjhprklxlezdbudi@im.wechat",
        SenderId: "o9cq80xlx0ztnjhprklxlezdbudi@im.wechat",
        ChatType: "direct",
        SessionKey:
          "agent:main:openclaw-weixin:15b6a1154038-im-bot:direct:o9cq80xlx0ztnjhprklxlezdbudi@im.wechat",
        BodyForCommands: "记一下，我明天晚上八点十五，虹桥火车站的高铁去香港",
      });

      await tryHandleBundledSkillFastpass(
        { ctx },
        {
          execFile,
          stateDir: "/tmp/openclaw-state",
          env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
          calendarScriptPath: "/tmp/fake-sc",
        },
      );

      expect(execFile.mock.calls[0]?.[1]).toEqual([
        "/tmp/fake-sc",
        "add",
        "--date",
        "2026-04-03",
        "--time",
        "20:15",
        "--title",
        "高铁去香港",
        "--category",
        "出行",
        "--location",
        "虹桥火车站",
        "我明天晚上八点十五，虹桥火车站的高铁去香港",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fast-passes direct schedule lookups into calendar show", async () => {
    const execFile = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stdout: "📅 这周安排",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout:
          "🎨 正在生成 week 视图日历图...\n✅ 日历图已生成: /tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png\n\n📅 这周安排",
        stderr: "",
      });
    const ctx = buildTestCtx({
      Provider: "openclaw-weixin",
      Surface: "openclaw-weixin",
      OriginatingChannel: "openclaw-weixin",
      OriginatingTo: "wx-user-1",
      ChatType: "direct",
      SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      BodyForCommands: "看看这周和张总的日程",
    });

    const result = await tryHandleBundledSkillFastpass(
      { ctx },
      {
        execFile,
        stateDir: "/tmp/openclaw-state",
        env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
        calendarScriptPath: "/tmp/fake-sc",
      },
    );

    expect(result).toEqual({
      handled: true,
      payload: {
        text: "📅 这周安排",
        mediaUrl:
          "/tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png",
      },
      reason: "bundled_skill_fastpass_calendar_show_render",
    });
    expect(execFile.mock.calls[0]?.[1]).toEqual([
      "/tmp/fake-sc",
      "show",
      "--week",
      "--with",
      "张总",
    ]);
    expect(execFile.mock.calls[1]?.[1]).toEqual([
      "/tmp/fake-sc",
      "render",
      "--week",
      "--view",
      "week",
      "--with",
      "张总",
    ]);
  });

  it("returns a media payload when the user asks for a schedule image", async () => {
    const execFile = vi.fn(async () => ({
      code: 0,
      stdout:
        "🎨 正在生成 week 视图日历图...\n✅ 日历图已生成: /tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png\n\n📅 这周安排",
      stderr: "",
    }));
    const ctx = buildTestCtx({
      Provider: "openclaw-weixin",
      Surface: "openclaw-weixin",
      OriginatingChannel: "openclaw-weixin",
      OriginatingTo: "wx-user-1",
      ChatType: "direct",
      SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      BodyForCommands: "把本周日历图发给我",
    });

    const result = await tryHandleBundledSkillFastpass(
      { ctx },
      {
        execFile,
        stateDir: "/tmp/openclaw-state",
        env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
        calendarScriptPath: "/tmp/fake-sc",
      },
    );

    expect(result).toEqual({
      handled: true,
      payload: {
        text: "🎨 正在生成 week 视图日历图...\n✅ 日历图已生成",
        mediaUrl:
          "/tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png",
      },
      reason: "bundled_skill_fastpass_calendar_render",
    });
    expect(execFile.mock.calls[0]?.[1]).toEqual([
      "/tmp/fake-sc",
      "render",
      "--week",
      "--view",
      "week",
    ]);
  });

  it("uses a concrete future-seven-days range for text-only schedule summaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T09:00:00+08:00"));
    try {
      const execFile = vi.fn(async () => ({
        code: 0,
        stdout: "📅 未来七天安排",
        stderr: "",
      }));
      const ctx = buildTestCtx({
        Provider: "openclaw-weixin",
        Surface: "openclaw-weixin",
        OriginatingChannel: "openclaw-weixin",
        OriginatingTo: "wx-user-1",
        ChatType: "direct",
        SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        BodyForCommands: "给我未来七天的日程文字总结版",
      });

      const result = await tryHandleBundledSkillFastpass(
        { ctx },
        {
          execFile,
          stateDir: "/tmp/openclaw-state",
          env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
          calendarScriptPath: "/tmp/fake-sc",
        },
      );

      expect(result).toEqual({
        handled: true,
        payload: {
          text: "📅 未来七天安排",
        },
        reason: "bundled_skill_fastpass_calendar_show",
      });
      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile.mock.calls[0]?.[1]).toEqual([
        "/tmp/fake-sc",
        "show",
        "--range",
        "2026-04-01~2026-04-07",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns text and image by default for future-ten-days lookups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T09:00:00+08:00"));
    try {
      const execFile = vi
        .fn()
        .mockResolvedValueOnce({
          code: 0,
          stdout: "📅 未来十天安排",
          stderr: "",
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout:
            "🎨 正在生成 week 视图日历图...\n✅ 日历图已生成: /tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png",
          stderr: "",
        });
      const ctx = buildTestCtx({
        Provider: "openclaw-weixin",
        Surface: "openclaw-weixin",
        OriginatingChannel: "openclaw-weixin",
        OriginatingTo: "wx-user-1",
        ChatType: "direct",
        SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
        BodyForCommands: "发我未来10天的日程",
      });

      const result = await tryHandleBundledSkillFastpass(
        { ctx },
        {
          execFile,
          stateDir: "/tmp/openclaw-state",
          env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
          calendarScriptPath: "/tmp/fake-sc",
        },
      );

      expect(result).toEqual({
        handled: true,
        payload: {
          text: "📅 未来十天安排",
          mediaUrl:
            "/tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_week.png",
        },
        reason: "bundled_skill_fastpass_calendar_show_render",
      });
      expect(execFile.mock.calls[0]?.[1]).toEqual([
        "/tmp/fake-sc",
        "show",
        "--range",
        "2026-04-01~2026-04-10",
      ]);
      expect(execFile.mock.calls[1]?.[1]).toEqual([
        "/tmp/fake-sc",
        "render",
        "--range",
        "2026-04-01~2026-04-10",
        "--view",
        "week",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unwraps cron reminder prompts and resolves them through the same schedule fast-pass", async () => {
    const execFile = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stdout: "📅 今天安排",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout:
          "🎨 正在生成 day 视图日历图...\n✅ 日历图已生成: /tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_day.png",
        stderr: "",
      });
    const ctx = buildTestCtx({
      Provider: "cron-event",
      OriginatingChannel: "openclaw-weixin",
      OriginatingTo: "wx-user-1",
      ChatType: "direct",
      SessionKey: "agent:main:openclaw-weixin:primary:direct:wx-user-1",
      Body: "A scheduled reminder has been triggered. The reminder content is:\n\n发我今天的日程，文字总结版和日历图片都要\n\nPlease relay this reminder to the user in a helpful and friendly way.",
    });

    const result = await tryHandleBundledSkillFastpass(
      { ctx },
      {
        execFile,
        stateDir: "/tmp/openclaw-state",
        env: { OPENCLAW_STATE_DIR: "/tmp/openclaw-state" },
        calendarScriptPath: "/tmp/fake-sc",
      },
    );

    expect(result).toEqual({
      handled: true,
      payload: {
        text: "📅 今天安排",
        mediaUrl:
          "/tmp/openclaw-state/skills-data/smart-calendar/weixin-dm/primary/wx-user-1/output/calendar_day.png",
      },
      reason: "bundled_skill_fastpass_calendar_show_render",
    });
    expect(execFile.mock.calls[0]?.[1]).toEqual([
      "/tmp/fake-sc",
      "show",
      "--date",
      "今天的日程，文字总结版和日历图片都要",
    ]);
    expect(execFile.mock.calls[1]?.[1]).toEqual([
      "/tmp/fake-sc",
      "render",
      "--view",
      "day",
      "--date",
      "今天的日程，文字总结版和日历图片都要",
    ]);
  });
});
