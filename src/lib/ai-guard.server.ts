// Server-only capacity protection for AI-backed operations.
// - In-flight single-flight dedup (idempotency-key based)
// - Concurrency semaphore with bounded queue wait
// - Circuit breaker on repeated AI failures
// - Retry with Retry-After + jittered exponential backoff for 429s
//
// State is per-Worker isolate. That is acceptable for a 50-200 user burst
// on a single deployment; it is not a distributed limiter.

const MAX_CONCURRENT_AI = 8;
const QUEUE_WAIT_TIMEOUT_MS = 12_000;

const BREAKER_FAIL_THRESHOLD = 5;
const BREAKER_FAIL_WINDOW_MS = 30_000;
const BREAKER_OPEN_MS = 30_000;

const RETRY_MAX_ATTEMPTS = 2; // in addition to the initial try
const RETRY_BASE_MS = 400;
const RETRY_MAX_DELAY_MS = 4_000;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------- Semaphore ----------

let inFlight = 0;
const waiters: Array<Deferred<void>> = [];

function acquireSlot(): Promise<() => void> {
  if (inFlight < MAX_CONCURRENT_AI) {
    inFlight++;
    return Promise.resolve(release);
  }
  const d = defer<void>();
  waiters.push(d);
  const timeout = setTimeout(() => {
    const idx = waiters.indexOf(d);
    if (idx >= 0) {
      waiters.splice(idx, 1);
      d.reject(new Error("AI_BUSY_QUEUE_TIMEOUT"));
    }
  }, QUEUE_WAIT_TIMEOUT_MS);
  return d.promise.then(() => {
    clearTimeout(timeout);
    return release;
  });
}

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) {
    inFlight++;
    next.resolve();
  }
}

export function getCapacityStats() {
  return { inFlight, queued: waiters.length, maxConcurrent: MAX_CONCURRENT_AI };
}

// ---------- Circuit breaker ----------

let breakerOpenedAt = 0;
let recentFailures: number[] = [];

function breakerIsOpen(): boolean {
  if (breakerOpenedAt === 0) return false;
  if (Date.now() - breakerOpenedAt < BREAKER_OPEN_MS) return true;
  // Half-open: allow one probe.
  return false;
}

function noteAiSuccess(): void {
  breakerOpenedAt = 0;
  recentFailures = [];
}

function noteAiFailure(): void {
  const now = Date.now();
  recentFailures = recentFailures.filter((t) => now - t < BREAKER_FAIL_WINDOW_MS);
  recentFailures.push(now);
  if (recentFailures.length >= BREAKER_FAIL_THRESHOLD) {
    breakerOpenedAt = now;
  }
}

export function getBreakerStatus(): "closed" | "open" | "half_open" {
  if (breakerOpenedAt === 0) return "closed";
  if (Date.now() - breakerOpenedAt < BREAKER_OPEN_MS) return "open";
  return "half_open";
}

// ---------- Retry / backoff ----------

function jitter(ms: number): number {
  return ms / 2 + Math.random() * ms;
}

function parseRetryAfter(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(RETRY_MAX_DELAY_MS, seconds * 1000));
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) return Math.max(0, Math.min(RETRY_MAX_DELAY_MS, asDate - Date.now()));
  return null;
}

export class AiRateLimitError extends Error {
  retryAfterMs: number | null;
  constructor(retryAfterMs: number | null) {
    super("AI_RATE_LIMITED");
    this.retryAfterMs = retryAfterMs;
  }
}
export class AiUnavailableError extends Error {
  constructor() {
    super("AI_UNAVAILABLE");
  }
}
export class AiBusyError extends Error {
  constructor() {
    super("AI_BUSY_QUEUE_TIMEOUT");
  }
}

// Runs `fn` under semaphore + breaker + retry.
// `fn` should throw AiRateLimitError to trigger a retry; any other throw
// counts as a hard failure (still contributes to the breaker).
export async function guardedAiCall<T>(fn: () => Promise<T>): Promise<T> {
  if (breakerIsOpen()) throw new AiUnavailableError();

  let releaseSlot: () => void;
  try {
    releaseSlot = await acquireSlot();
  } catch (e) {
    if (e instanceof Error && e.message === "AI_BUSY_QUEUE_TIMEOUT") {
      throw new AiBusyError();
    }
    throw e;
  }

  try {
    let attempt = 0;
    while (true) {
      try {
        const result = await fn();
        noteAiSuccess();
        return result;
      } catch (err) {
        if (err instanceof AiRateLimitError && attempt < RETRY_MAX_ATTEMPTS) {
          const delay =
            err.retryAfterMs ??
            jitter(Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** attempt));
          attempt++;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        noteAiFailure();
        if (err instanceof AiRateLimitError) throw new AiBusyError();
        throw err;
      }
    }
  } finally {
    releaseSlot();
  }
}

// ---------- Single-flight registry (idempotency) ----------

type InFlightEntry = { promise: Promise<unknown>; expiresAt: number };
const inFlightByKey = new Map<string, InFlightEntry>();
const SINGLE_FLIGHT_TTL_MS = 60_000;

function sweepInFlight(): void {
  const now = Date.now();
  for (const [k, v] of inFlightByKey) {
    if (v.expiresAt < now) inFlightByKey.delete(k);
  }
}

// Dedups concurrent identical requests. If a request with the same key is
// already in flight, its result is returned to every caller.
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  sweepInFlight();
  const existing = inFlightByKey.get(key);
  if (existing) return existing.promise as Promise<T>;
  const promise = fn().finally(() => {
    // Keep the completed promise around briefly so a tap-happy client
    // still gets the same answer instead of a fresh AI call.
    setTimeout(() => inFlightByKey.delete(key), 2_000);
  });
  inFlightByKey.set(key, { promise, expiresAt: Date.now() + SINGLE_FLIGHT_TTL_MS });
  return promise;
}