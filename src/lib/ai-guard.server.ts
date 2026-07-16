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

// ---------- Sliding-window burst limiter (per-key, per-isolate) ----------
//
// Tracks recent hit timestamps per key. Used for per-session and per-user
// burst limits. State is per-Worker isolate; that is acceptable for beta
// scale — this is a first line of defence, not a distributed limiter.

const WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

function pruneBucket(key: string, now: number): number[] {
  const arr = rateBuckets.get(key);
  if (!arr) return [];
  const kept = arr.filter((t) => now - t < WINDOW_MS);
  if (kept.length === 0) rateBuckets.delete(key);
  else rateBuckets.set(key, kept);
  return kept;
}

// Returns true when this hit is allowed. `limit <= 0` disables the check.
export function allowBurst(key: string, limit: number): boolean {
  if (!limit || limit <= 0) return true;
  const now = Date.now();
  const kept = pruneBucket(key, now);
  if (kept.length >= limit) return false;
  kept.push(now);
  rateBuckets.set(key, kept);
  return true;
}

// ---------- Cached global AI-call counters ----------
//
// Cached to avoid running COUNT() against product_events on every parse.

type CountSnapshot = { today: number; month: number; at: number };
let countCache: CountSnapshot | null = null;
const COUNT_TTL_MS = 30_000;

export async function getGlobalAiCounts(): Promise<{ today: number; month: number }> {
  if (countCache && Date.now() - countCache.at < COUNT_TTL_MS) {
    return { today: countCache.today, month: countCache.month };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (
        c: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (a: string, b: string) => {
          gte: (a: string, b: string) => Promise<{ count: number | null; error: unknown }>;
        };
      };
    };
  };
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [dayRes, monthRes] = await Promise.all([
    admin
      .from("product_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "food_parse_succeeded")
      .gte("created_at", startOfDay),
    admin
      .from("product_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "food_parse_succeeded")
      .gte("created_at", startOfMonth),
  ]);
  const today = dayRes.count ?? 0;
  const month = monthRes.count ?? 0;
  countCache = { today, month, at: Date.now() };
  return { today, month };
}

export async function getUserDailyAiCount(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (
        c: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (a: string, b: string) => {
          eq: (a: string, b: string) => {
            gte: (a: string, b: string) => Promise<{ count: number | null; error: unknown }>;
          };
        };
      };
    };
  };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const res = await admin
    .from("product_events")
    .select("id", { count: "exact", head: true })
    .eq("event_name", "food_parse_succeeded")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());
  return res.count ?? 0;
}

// Beta usage counters — PHT day boundary.
// A "submission" = one successful food_parse_succeeded event for this user
// since PHT midnight. Editing / deleting / preparation toggles never emit
// this event, so they don't consume the allowance.

export function phtDayStartIso(): string {
  const nowMs = Date.now();
  const phtOffsetMs = 8 * 60 * 60 * 1000;
  const phtNow = new Date(nowMs + phtOffsetMs);
  const y = phtNow.getUTCFullYear();
  const m = phtNow.getUTCMonth();
  const d = phtNow.getUTCDate();
  const midnightUtcMs = Date.UTC(y, m, d, 0, 0, 0) - phtOffsetMs;
  return new Date(midnightUtcMs).toISOString();
}

export function phtNextDayStartIso(): string {
  return new Date(new Date(phtDayStartIso()).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export async function getUserDailySubmissionCount(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (
        c: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (a: string, b: string) => {
          eq: (a: string, b: string) => {
            gte: (a: string, b: string) => Promise<{ count: number | null; error: unknown }>;
          };
        };
      };
    };
  };
  const res = await admin
    .from("product_events")
    .select("id", { count: "exact", head: true })
    .eq("event_name", "food_parse_succeeded")
    .eq("user_id", userId)
    .gte("created_at", phtDayStartIso());
  return res.count ?? 0;
}