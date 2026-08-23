/**
 * Tests for GitHub token leak prevention — non-enumerable token property.
 */

import { describe, it, expect } from "vitest";
import { detectGitHubConfig } from "./inline-comments.js";

describe("GitHubConfig token security", () => {
  it("makes token non-enumerable so JSON.stringify does not include it", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    const originalRepo = process.env.GITHUB_REPOSITORY;
    const originalEventPath = process.env.GITHUB_EVENT_PATH;

    // Set up minimal environment
    process.env.GITHUB_TOKEN = "ghp_secret123456";
    process.env.GITHUB_REPOSITORY = "test/repo";
    // Create a minimal event JSON
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = os.tmpdir();
    const eventFile = path.join(tmpDir, "flaught-test-event.json");
    fs.writeFileSync(eventFile, JSON.stringify({
      pull_request: {
        number: 42,
        base: { sha: "abc123" },
        head: { sha: "def456" },
      },
    }));
    process.env.GITHUB_EVENT_PATH = eventFile;

    try {
      const config = await detectGitHubConfig();
      expect(config).not.toBeNull();

      // Token is accessible via property access
      expect(config!.token).toBe("ghp_secret123456");

      // Token is NOT included in JSON.stringify
      const serialized = JSON.stringify(config);
      expect(serialized).not.toContain("ghp_secret123456");
      expect(serialized).not.toContain("secret");

      // Token is NOT included in Object.keys
      expect(Object.keys(config!)).not.toContain("token");

      // Token is NOT included in spread
      const spread = { ...config! };
      expect(spread.token).toBeUndefined();

      // Other fields ARE included
      expect(config!.repository).toBe("test/repo");
      expect(config!.pullNumber).toBe(42);
    } finally {
      // Restore env
      if (originalToken !== undefined) {
        process.env.GITHUB_TOKEN = originalToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
      if (originalRepo !== undefined) {
        process.env.GITHUB_REPOSITORY = originalRepo;
      } else {
        delete process.env.GITHUB_REPOSITORY;
      }
      if (originalEventPath !== undefined) {
        process.env.GITHUB_EVENT_PATH = originalEventPath;
      } else {
        delete process.env.GITHUB_EVENT_PATH;
      }
      try {
        fs.unlinkSync(eventFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});