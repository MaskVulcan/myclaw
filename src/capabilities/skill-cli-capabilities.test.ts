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

  it("runs smart-calendar.edit through the bundled wrapper with explicit flags", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout:
        '{"ok":true,"calendar_home":"/tmp/cal","event":{"id":"evt_20260403_abc123","date":"2026-04-03","time":"16:00-17:00","title":"和张总开会","category":"会议","participants":["张总"],"location":"","notes":"","priority":"normal","icon":"🤝"}}',
      stderr: "",
    });

    const result = await runCapability({
      id: "smart-calendar.edit",
      input: {
        calendarHome: "/tmp/cal",
        eventId: "evt_20260403_abc123",
        time: "16:00-17:00",
        withPeople: ["张总"],
      },
    });

    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      [
        "/tmp/sc",
        "edit",
        "evt_20260403_abc123",
        "--json",
        "--time",
        "16:00-17:00",
        "--with",
        "张总",
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          SMART_CALENDAR_HOME: "/tmp/cal",
        }),
      }),
    );
    expect(result.output).toMatchObject({
      event: expect.objectContaining({
        time: "16:00-17:00",
      }),
    });
  });

  it("runs document-processing.docx-compare through the bundled wrapper", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        original_paragraphs: 3,
        revised_paragraphs: 3,
        changes: [
          {
            op: "replace",
            original_range: [2, 2],
            revised_range: [2, 2],
            original: ["旧内容"],
            revised: ["新内容"],
          },
        ],
        unified_diff: "@@ -2 +2 @@",
      }),
      stderr: "",
    });

    const result = await runCapability({
      id: "document-processing.docx-compare",
      input: {
        original: "contract.docx",
        revised: "contract.edited.docx",
      },
    });

    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/docpipe", "docx-compare", "contract.docx", "contract.edited.docx"],
      expect.any(Object),
    );
    expect(result.output).toMatchObject({
      original_paragraphs: 3,
      changes: [expect.objectContaining({ op: "replace" })],
    });
  });

  it("runs smart-calendar.stats through the bundled wrapper", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        calendar_home: "/tmp/cal",
        period_kind: "week",
        scope: "category",
        category: "会议",
        results: [
          {
            category: "会议",
            period: "4.7-4.13",
            total: 2,
            daily_counts: { "2026-04-07": 1, "2026-04-08": 1 },
            avg_per_day: 0.29,
            peak_weekday: "周二",
            peak_count: 1,
            active_days: 2,
            total_days: 7,
          },
        ],
      }),
      stderr: "",
    });

    const result = await runCapability({
      id: "smart-calendar.stats",
      input: {
        calendarHome: "/tmp/cal",
        category: "会议",
        week: true,
      },
    });

    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/sc", "stats", "会议", "--week", "--json"],
      expect.objectContaining({
        env: expect.objectContaining({
          SMART_CALENDAR_HOME: "/tmp/cal",
        }),
      }),
    );
    expect(result.output).toMatchObject({
      scope: "category",
      results: [expect.objectContaining({ total: 2 })],
    });
  });

  it("runs smart-calendar.people.note through the bundled wrapper", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        calendar_home: "/tmp/cal",
        note_type: "tip",
        note: "会议材料提前一天发",
        person: {
          name: "张总",
          role: "VP",
          personality: [],
          collaboration_tips: ["会议材料提前一天发"],
          contact: "",
          tags: [],
          notes: "",
        },
      }),
      stderr: "",
    });

    const result = await runCapability({
      id: "smart-calendar.people.note",
      input: {
        calendarHome: "/tmp/cal",
        name: "张总",
        note: "会议材料提前一天发",
        asTip: true,
      },
    });

    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/sc", "people", "note", "张总", "--as-tip", "--json", "会议材料提前一天发"],
      expect.objectContaining({
        env: expect.objectContaining({
          SMART_CALENDAR_HOME: "/tmp/cal",
        }),
      }),
    );
    expect(result.output).toMatchObject({
      note_type: "tip",
      person: expect.objectContaining({
        name: "张总",
      }),
    });
  });

  it("runs document-processing.doctor through the bundled wrapper", async () => {
    execFileUtf8Mock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        available: ["python", "unstructured"],
        missing: ["mineru"],
        backends: { odl_pdf: false, mineru: false },
        features: { pdf_ingest: true, local_ocr: false },
      }),
      stderr: "",
    });

    const result = await runCapability({
      id: "document-processing.doctor",
      input: {},
    });

    expect(execFileUtf8Mock).toHaveBeenCalledWith(
      "bash",
      ["/tmp/docpipe", "doctor"],
      expect.any(Object),
    );
    expect(result.output).toMatchObject({
      available: ["python", "unstructured"],
      backends: expect.objectContaining({ mineru: false }),
    });
  });
});
