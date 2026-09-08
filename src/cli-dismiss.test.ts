import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FINDING_ID_CAVEAT } from "./schemas/findings.js";

const originalArgv = process.argv;
const tempDirs: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("flaught dismiss", () => {
  it("prints the run-local finding ID caveat before dismissing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flaught-cli-dismiss-"));
    tempDirs.push(dir);
    const artifactPath = path.join(dir, "findings.json");
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        findings: [
          {
            id: "D-0001",
            title: "Test finding",
            fingerprint: "sha256:test-fingerprint",
            evidence: { file: "src/test.ts" },
          },
        ],
      }),
      "utf-8",
    );

    process.argv = [
      process.execPath,
      "flaught",
      "dismiss",
      "D-0001",
      "--artifact",
      artifactPath,
      "--reason",
      "Test dismissal",
      "--by",
      "reviewer@example.com",
      "--repo",
      dir,
    ];

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected CLI exit: ${code}`);
    });
    vi.resetModules();

    await import("./cli.js");
    await vi.waitFor(() => {
      expect(fs.existsSync(path.join(dir, ".flaught-dismissals.json"))).toBe(true);
    });

    const caveatIndex = logs.findIndex((line) => line === FINDING_ID_CAVEAT);
    const dismissedIndex = logs.findIndex((line) => line.startsWith("✅ Dismissed D-0001"));

    expect(caveatIndex).toBeGreaterThanOrEqual(0);
    expect(dismissedIndex).toBeGreaterThan(caveatIndex);
  });
});
