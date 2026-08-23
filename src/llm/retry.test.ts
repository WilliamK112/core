/**
 * Tests for the retry utility — exponential backoff with jitter for transient HTTP failures.
 */

import { describe, it, expect } from "vitest";
import { withRetry, backoffDelay, isRetryableStatus } from "./retry.js";
import { LLMError } from "./provider.js";

describe("isRetryableStatus", () => {
  it("retries on 429 (rate limit)", () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("retries on 500 (internal server error)", () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  it("retries on 502 (bad gateway)", () => {
    expect(isRetryableStatus(502)).toBe(true);
  });

  it("retries on 503 (service unavailable)", () => {
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("retries on 529 (Anthropic overloaded)", () => {
    expect(isRetryableStatus(529)).toBe(true);
  });

  it("does not retry on 400 (bad request)", () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  it("does not retry on 401 (unauthorized)", () => {
    expect(isRetryableStatus(401)).toBe(false);
  });

  it("does not retry on 403 (forbidden)", () => {
    expect(isRetryableStatus(403)).toBe(false);
  });

  it("does not retry on 404 (not found)", () => {
    expect(isRetryableStatus(404)).toBe(false);
  });

  it("does not retry on 200 (success)", () => {
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("uses exponential backoff: base * 2^attempt", () => {
    // Without jitter, delay would be: 1000 * 2^0 = 1000, 1000 * 2^1 = 2000, etc.
    // With jitter (0 to base), delay is in range [base * 2^attempt, base * 2^attempt + base]
    const delay0 = backoffDelay(0, 1000);
    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThanOrEqual(2000);

    const delay1 = backoffDelay(1, 1000);
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay1).toBeLessThanOrEqual(3000);

    const delay2 = backoffDelay(2, 1000);
    expect(delay2).toBeGreaterThanOrEqual(4000);
    expect(delay2).toBeLessThanOrEqual(5000);
  });

  it("respects different base delays", () => {
    const delay = backoffDelay(0, 500);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);
  });
});

describe("withRetry", () => {
  it("returns the result immediately on success", async () => {
    const result = await withRetry(
      async () => "success",
      { maxRetries: 2, baseDelayMs: 10 },
    );
    expect(result).toBe("success");
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new LLMError("Rate limited", "groq", "test-model", 429);
      }
      return "success";
    };

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const error = new LLMError("Rate limited", "groq", "test-model", 429);
    const fn = async () => {
      throw error;
    };

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow("Rate limited");
  });

  it("does not retry on non-retryable LLM errors (401)", async () => {
    const error = new LLMError("Unauthorized", "groq", "test-model", 401);
    let attempts = 0;
    const wrappedFn = async () => {
      attempts++;
      throw error;
    };

    await expect(
      withRetry(wrappedFn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow("Unauthorized");
    expect(attempts).toBe(1); // No retries
  });

  it("does not retry on 404 errors", async () => {
    const error = new LLMError("Model not found", "groq", "test-model", 404);
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw error;
    };

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow("Model not found");
    expect(attempts).toBe(1);
  });

  it("retries on network errors (no status code)", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 2) {
        throw new LLMError("Could not reach model", "groq", "test-model");
      }
      return "success";
    };

    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });

  it("does not retry on AbortError (timeout)", async () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw error;
    };

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("succeeds immediately when maxRetries is 0", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      return "success";
    };

    const result = await withRetry(fn, { maxRetries: 0, baseDelayMs: 10 });
    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  it("does not retry when maxRetries is 0 and the call fails", async () => {
    const error = new LLMError("Rate limited", "groq", "test-model", 429);
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw error;
    };

    await expect(
      withRetry(fn, { maxRetries: 0, baseDelayMs: 10 }),
    ).rejects.toThrow("Rate limited");
    expect(attempts).toBe(1);
  });

  it("calls onProgress before each retry", async () => {
    const messages: string[] = [];
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new LLMError("Rate limited", "groq", "test-model", 429);
      }
      return "success";
    };

    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }, (msg) => messages.push(msg));
    expect(result).toBe("success");
    expect(messages.length).toBe(2);
  });
});