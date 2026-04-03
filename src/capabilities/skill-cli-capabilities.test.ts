import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileUtf8Mock = vi.hoisted(() => vi.fn());
const resolveCalendarScriptPathMock = vi.hoisted(() => vi.fn(() => "/tmp/sc"));
const resolveDocpipeScriptPathMock = vi.hoisted(() => vi.fn(() => "/tmp/docpipe"));

vi.mock("../daemon/exec-file.js", () => ({
  execFileUtf8: execFileUtf8Mock,
}));

vi.mock("../cli/calendar-cli.js", () => ({
  resolveCalendarScriptPath: resolveCalendarScriptPathMock,
}));

vi.mock("../cli/docpipe-cli.js", () => ({
  resolveDocpipeScriptPath: resolveDocpipeScriptPathMock,
}));

describe("skill-backed capabilities", () => {
  let runCapability: typeof import("./registry.js").runCapability;

  beforeEach(async () => {
    vi.resetModules();
    ({ runCapability } = await import("./registry.js"));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs smart-calendar.add through the bundled wrapper with JSON output", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout:
        'bootstrap logs\n{"ok":true,"calendar_home":"/tmp/cal","event":{"id":"evt_20260403_abc123","date":"2026-04-03","time":"15:00","title":"和张总开会","category":"会议","participants":[],"location":"","notes":"","priority":"normal","icon":"🤝"},"conflicts":[]}',
      stderr: "",
    });

    const result = await runCapability({
      id: "smart-calendar.add",
      input: {
        calendarHome: "/tmp/cal",
        text: "明天下午三点和张总开会",
        category: "会议",
      },
    });

    expect(resolveCalendarScriptPathMock).toHaveBeenCalled();
    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/sc", "add", "--json", "--category", "会议", "明天下午三点和张总开会"],
      expect.objectContaining({
        env: expect.objectContaining({
          SMART_CALENDAR_HOME: "/tmp/cal",
        }),
      }),
    );
    expect(result.output).toMatchObject({
      calendar_home: "/tmp/cal",
      event: expect.objectContaining({
        title: "和张总开会",
      }),
    });
  });

  it("runs document-processing.route through the bundled wrapper and parses trailing JSON", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout: [
        "dependency warning",
        "{",
        '  "lane": "pipeline",',
        '  "available": true,',
        '  "reason": "Transform-oriented document workflows should use the IR pipeline.",',
        '  "backend": "mineru",',
        '  "run_dir": "work/paper",',
        '  "commands": [["docpipe","ingest","paper.pdf","--run-dir","work/paper","--backend","mineru"]],',
        '  "warnings": []',
        "}",
      ].join("\n"),
      stderr: "",
    });

    const result = await runCapability({
      id: "document-processing.route",
      input: {
        source: "paper.pdf",
        task: "translate",
        layoutPreserving: true,
      },
    });

    expect(resolveDocpipeScriptPathMock).toHaveBeenCalled();
    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/docpipe", "route", "paper.pdf", "--task", "translate", "--layout-preserving"],
      expect.any(Object),
    );
    expect(result.output).toMatchObject({
      lane: "pipeline",
      available: true,
      backend: "mineru",
    });
  });
});
