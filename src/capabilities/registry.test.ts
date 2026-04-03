import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { writeSkill } from "../agents/skills.e2e-test-helpers.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
  type OpenClawConfig,
} from "../config/config.js";
import { createFixtureSuite } from "../test-utils/fixture-suite.js";
import {
  getCapabilityDescriptor,
  inferCapabilityIdsFromCommandLines,
  listCapabilityDescriptors,
  runCapability,
} from "./registry.js";

const fixtureSuite = createFixtureSuite("openclaw-capabilities-suite-");

beforeAll(async () => {
  await fixtureSuite.setup();
});

afterAll(async () => {
  await fixtureSuite.cleanup();
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
});

describe("capability registry", () => {
  it("lists built-in capability descriptors", () => {
    const capabilities = listCapabilityDescriptors();
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skills.list", category: "skills" }),
        expect.objectContaining({ id: "smart-calendar.add", category: "calendar" }),
        expect.objectContaining({ id: "document-processing.route", category: "documents" }),
        expect.objectContaining({ id: "steward.ingest", category: "steward" }),
      ]),
    );
  });

  it("describes schemas for one capability", () => {
    const description = getCapabilityDescriptor("steward.ingest");
    expect(description).toMatchObject({
      id: "steward.ingest",
      disclosureMode: "capabilities-first",
    });
    expect(description?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        workspace: expect.any(Object),
        recent: expect.any(Object),
      }),
    });
  });

  it("runs skills.list against an explicit workspace", async () => {
    const workspaceDir = await fixtureSuite.createCaseDir("workspace");
    await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "memory-steward"),
      name: "memory-steward",
      description: "Maintain memory with structured capabilities.",
      frontmatterExtra: [
        "capabilities:",
        '  - "steward.ingest"',
        'progressive-disclosure: "capabilities-first"',
      ].join("\n"),
    });

    setRuntimeConfigSnapshot({
      skills: {
        extraDirs: [],
      },
    } as OpenClawConfig);

    const result = await runCapability({
      id: "skills.list",
      input: {
        workspace: workspaceDir,
      },
    });

    const skills = (result.output as { skills?: Array<{ name?: string; capabilities?: string[] }> })
      .skills;
    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "memory-steward",
          capabilities: ["steward.ingest"],
        }),
      ]),
    );
  });

  it("infers known capabilities from observed CLI commands", () => {
    expect(
      inferCapabilityIdsFromCommandLines([
        "openclaw steward ingest --json",
        "/root/gitsource/myclaw/skills/smart-calendar/scripts/sc add 明天下午三点开会",
        "bash /root/gitsource/myclaw/skills/document-processing-pipeline/scripts/docpipe route paper.pdf --task translate",
        'openclaw capabilities run document-processing.ocr-pdf --input-json \'{"source":"scan.pdf"}\'',
        "git status",
      ]),
    ).toEqual([
      "document-processing.ocr-pdf",
      "document-processing.route",
      "smart-calendar.add",
      "steward.ingest",
    ]);
  });
});
