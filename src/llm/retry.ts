/**
 * Retry utility — exponential backoff with jitter for transient HTTP failures.
 *
 * Retries on 429 (rate limit) and 5xx (server error) responses. Other status
 * codes (4xx client errors) are not retried — they indicate a problem with
 * the request itself, not a transient failure.
 *
 * The backoff formula is: base_delay * 2^attempt + random_jitter, where
 * jitter is a random value between 0 and base_delay. This avoids the thundering
 * herd problem when multiple clients retry simultaneously.
 */

import { LLMError } from "./provider.js";

export interface RetryConfig {
  /** Maximum number of retries (0 = no retries, fail immediately) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1000,
};

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate the backoff delay for a given attempt.
 *
 * Uses exponential backoff with jitter: base * 2^attempt + random(0, base)
 * This spreads retries over time and avoids synchronized retry storms.
 */
export function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return exponential + jitter;
}

/**
 * Whether an HTTP status code is retryable.
 *
 * 429 = rate limited (try again later)
 * 5xx = server error (transient, may resolve on retry)
 * 4xx other than 429 = client error (don't retry — the request itself is wrong)
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Execute an async operation with retry and exponential backoff.
 *
 * Retries on 429 and 5xx HTTP responses (from LLMError) and on network errors
 * (from fetch failures that don't produce a response at all).
 *
 * @param fn - The async operation to attempt
 * @param config - Retry configuration
 * @param onRetry - Optional callback called before each retry with attempt number and delay
 * @returns The result of fn()
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onProgress?: (message: string) => void,
): Promise<T> {
  const { maxRetries, baseDelayMs } = { ...DEFAULT_RETRY_CONFIG, ...config };

  if (maxRetries === 0) {
    return fn();
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Only retry on retryable errors
      if (!isRetryableError(err)) {
        throw err;
      }

      // Don't sleep on the last attempt (we've exhausted retries)
      if (attempt === maxRetries) {
        throw err;
      }

      const delay = backoffDelay(attempt, baseDelayMs);
      const retryNum = attempt + 1;

      if (onProgress && err instanceof LLMError) {
        onProgress(
          `  ⚠ ${err.message.split("\n")[0]} — retrying in ${Math.round(delay / 1000)}s (attempt ${retryNum}/${maxRetries})`,
        );
      }

      await sleep(delay);
    }
  }

  // Should be unreachable, but TypeScript needs it
  throw lastError;
}

/**
 * Whether an error is retryable (429 rate limit, 5xx server error, or network error).
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof LLMError) {
    // 429 rate limit and 5xx server errors are retryable
    if (err.statusCode === 429) return true;
    if (err.statusCode && err.statusCode >= 500 && err.statusCode <= 599) return true;
    // Network errors (no status code) are also retryable
    if (!err.statusCode) return true;
    // Other LLM errors (401, 403, 404) are not retryable
    return false;
  }

  // Network-level errors (fetch failures) are retryable
  if (err instanceof Error) {
    // AbortError is from our timeout — don't retry
    if (err.name === "AbortError") return false;
    // Other errors from fetch (ECONNREFUSED, ECONNRESET, etc.) are retryable
    return true;
  }

  return false;
}