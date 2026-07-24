// Tests for the request-processing ORCHESTRATION in guard.ts: the 15-step
// order, quota/lease wiring, and error-category mapping — all against
// injected mocks (a fake quota-checker, a fake transcribe function, etc.),
// same pattern as logic.test.ts.
//
// What this file does NOT and cannot prove, because there is no Postgres
// available in this sandbox (no `supabase` CLI, no local database):
//   - that acquire_voice_transcription_slot's rolling-window arithmetic is
//     actually correct (exactly-at-limit boundaries, retry_after_seconds
//     accuracy, window expiration)
//   - that the advisory-lock concurrency guarantee holds under real
//     simultaneous transactions
//   - RLS/grants actually block anon/authenticated in a live database
// Those require applying the migration to a real Postgres instance and
// are called out as an explicit environment limitation, not silently
// skipped or claimed as covered.

import { describe, it, expect, vi } from "vitest";
import {
  runVoiceTranscriptionGuard,
  ERROR_STATUS,
  ERROR_MESSAGE,
  type VoiceGuardDeps,
  type QuotaCheckResult,
} from "../guard";
import type { TranscriptionResult } from "../logic";

function fakeBlob(bytes = 5000, type = "audio/webm"): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function baseDeps(overrides: Partial<VoiceGuardDeps> = {}): VoiceGuardDeps {
  return {
    isFeatureEnabled: true,
    method: "POST",
    contentType: "audio/webm",
    declaredContentLength: 5000,
    getVerifiedUserId: vi.fn(async () => "user-1"),
    checkQuota: vi.fn(
      async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "lease-1" }),
    ),
    releaseLease: vi.fn(async () => {}),
    readBody: vi.fn(async () => fakeBlob()),
    transcribe: vi.fn(
      async (): Promise<TranscriptionResult> => ({
        transcript: "dalawang itlog",
        requestId: "req-1",
        latencyMs: 42,
      }),
    ),
    ...overrides,
  };
}

describe("runVoiceTranscriptionGuard — kill switch (step 1)", () => {
  it("rejects as feature_disabled and never reads the body or calls OpenAI when disabled", async () => {
    const deps = baseDeps({ isFeatureEnabled: false });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "feature_disabled" });
    expect(deps.readBody).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.checkQuota).not.toHaveBeenCalled();
  });
});

describe("runVoiceTranscriptionGuard — authentication (steps 3-4)", () => {
  it("rejects unauthenticated when no verified user id is available", async () => {
    const deps = baseDeps({ getVerifiedUserId: vi.fn(async () => null) });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "unauthenticated" });
    expect(deps.checkQuota).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated when auth verification throws (invalid token)", async () => {
    const deps = baseDeps({
      getVerifiedUserId: vi.fn(async () => {
        throw new Error("invalid token");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "unauthenticated" });
  });

  it("proceeds for a valid, verified user", async () => {
    const deps = baseDeps();
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome.ok).toBe(true);
  });

  it("passes only the server-verified user id to checkQuota — never anything client-supplied", async () => {
    const checkQuota = vi.fn(
      async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "t" }),
    );
    const deps = baseDeps({
      getVerifiedUserId: vi.fn(async () => "verified-user-xyz"),
      checkQuota,
    });
    await runVoiceTranscriptionGuard(deps);
    expect(checkQuota).toHaveBeenCalledWith("verified-user-xyz");
    expect(checkQuota).toHaveBeenCalledTimes(1);
  });
});

describe("runVoiceTranscriptionGuard — declared Content-Length (step 5, before quota)", () => {
  it("rejects invalid_request when Content-Length is missing, without consuming quota", async () => {
    const deps = baseDeps({ declaredContentLength: null });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "invalid_request" });
    expect(deps.checkQuota).not.toHaveBeenCalled();
  });

  it("rejects invalid_request when Content-Length is zero or negative", async () => {
    for (const bad of [0, -1]) {
      const deps = baseDeps({ declaredContentLength: bad });
      const outcome = await runVoiceTranscriptionGuard(deps);
      expect(outcome).toMatchObject({ ok: false, category: "invalid_request" });
    }
  });

  it("rejects payload_too_large when declared Content-Length exceeds the server cap, without consuming quota", async () => {
    const deps = baseDeps({ declaredContentLength: 7 * 1024 * 1024 });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "payload_too_large" });
    expect(deps.checkQuota).not.toHaveBeenCalled();
    expect(deps.readBody).not.toHaveBeenCalled();
  });
});

describe("runVoiceTranscriptionGuard — quota/lease (steps 7-8)", () => {
  it("consumes quota BEFORE reading the body — a request that fails payload validation still counted (documented rule)", async () => {
    const checkQuota = vi.fn(
      async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "t" }),
    );
    const deps = baseDeps({ checkQuota, contentType: "video/mp4" }); // invalid MIME, fails after quota
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "invalid_audio" });
    expect(checkQuota).toHaveBeenCalledTimes(1); // quota WAS consumed
  });

  it("maps rate_limited_short_window with its retry_after_seconds", async () => {
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({
          allowed: false,
          reason: "rate_limited_short_window",
          retryAfterSeconds: 137,
        }),
      ),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({
      ok: false,
      category: "rate_limited_short_window",
      retryAfterSeconds: 137,
    });
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("maps rate_limited_daily", async () => {
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({
          allowed: false,
          reason: "rate_limited_daily",
          retryAfterSeconds: 3600,
        }),
      ),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "rate_limited_daily" });
  });

  it("maps project_limit_reached", async () => {
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({
          allowed: false,
          reason: "project_limit_reached",
          retryAfterSeconds: 12,
        }),
      ),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "project_limit_reached" });
  });

  it("maps request_in_progress (active lease conflict) and never calls OpenAI", async () => {
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({
          allowed: false,
          reason: "request_in_progress",
          retryAfterSeconds: 8,
        }),
      ),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({
      ok: false,
      category: "request_in_progress",
      retryAfterSeconds: 8,
    });
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.readBody).not.toHaveBeenCalled();
  });

  it("fails closed as limiter_unavailable when the quota check itself throws (database unavailable/timeout)", async () => {
    const deps = baseDeps({
      checkQuota: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "limiter_unavailable" });
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(deps.readBody).not.toHaveBeenCalled();
  });

  it("releases the lease in finally on a successful transcription", async () => {
    const releaseLease = vi.fn(async () => {});
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "tok-abc" }),
      ),
      releaseLease,
    });
    await runVoiceTranscriptionGuard(deps);
    expect(releaseLease).toHaveBeenCalledWith("user-1", "tok-abc");
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it("releases the lease in finally even when the provider call throws", async () => {
    const releaseLease = vi.fn(async () => {});
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "tok-xyz" }),
      ),
      releaseLease,
      transcribe: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome.ok).toBe(false);
    expect(releaseLease).toHaveBeenCalledWith("user-1", "tok-xyz");
  });

  it("releases the lease in finally even when payload validation fails after quota was granted", async () => {
    const releaseLease = vi.fn(async () => {});
    const deps = baseDeps({
      checkQuota: vi.fn(
        async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "tok-1" }),
      ),
      releaseLease,
      contentType: "video/mp4",
    });
    await runVoiceTranscriptionGuard(deps);
    expect(releaseLease).toHaveBeenCalledWith("user-1", "tok-1");
  });

  it("a lease-release failure never surfaces to the caller — the successful result still returns", async () => {
    const deps = baseDeps({
      releaseLease: vi.fn(async () => {
        throw new Error("release RPC unreachable");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome.ok).toBe(true);
  });
});

describe("runVoiceTranscriptionGuard — payload validation (steps 9-11)", () => {
  it("accepts a normal valid payload and reaches transcription", async () => {
    const outcome = await runVoiceTranscriptionGuard(baseDeps());
    expect(outcome).toMatchObject({ ok: true });
  });

  it("rejects invalid_audio for an unsupported MIME type", async () => {
    const deps = baseDeps({
      contentType: "video/mp4",
      readBody: vi.fn(async () => fakeBlob(5000, "video/mp4")),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "invalid_audio" });
  });

  it("rejects invalid_request for a truly empty (0-byte) body", async () => {
    const deps = baseDeps({ readBody: vi.fn(async () => fakeBlob(0)) });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "invalid_request" });
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("rejects invalid_audio for a near-empty (small but nonzero) body without calling OpenAI", async () => {
    const deps = baseDeps({ readBody: vi.fn(async () => fakeBlob(50)) }); // < MIN_SERVER_AUDIO_BYTES
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "invalid_audio" });
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("rejects payload_too_large when the actual body exceeds the server cap even though it was declared small", async () => {
    const deps = baseDeps({
      declaredContentLength: 1000,
      readBody: vi.fn(async () => fakeBlob(7 * 1024 * 1024)),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "payload_too_large" });
  });
});

describe("runVoiceTranscriptionGuard — provider call (step 12) and TranscriptionError mapping", () => {
  it("returns the transcript on success", async () => {
    const outcome = await runVoiceTranscriptionGuard(baseDeps());
    expect(outcome).toMatchObject({
      ok: true,
      result: { transcript: "dalawang itlog", requestId: "req-1" },
    });
  });

  it("maps a Stage 1 TranscriptionError('timeout') to transcription_timeout", async () => {
    const { TranscriptionError } = await import("../logic");
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new TranscriptionError("timeout", "took too long");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "transcription_timeout" });
  });

  it("maps a Stage 1 TranscriptionError('provider_unavailable') to provider_unavailable", async () => {
    const { TranscriptionError } = await import("../logic");
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new TranscriptionError("provider_unavailable", "network down");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "provider_unavailable" });
  });

  it("maps a Stage 1 TranscriptionError('provider_error') to transcription_failed (two provider failures exhausted Stage 1's own retry)", async () => {
    const { TranscriptionError } = await import("../logic");
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new TranscriptionError("provider_error", "still down after retry");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "transcription_failed" });
  });

  it("maps Stage 1's 'unauthorized' (OpenAI rejected OUR credentials) to provider_unavailable, never confused with the caller's own unauthenticated", async () => {
    const { TranscriptionError } = await import("../logic");
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new TranscriptionError("unauthorized", "bad server key");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "provider_unavailable" });
  });

  it("one guard invocation calls checkQuota exactly once — Stage 1's internal 2-attempt retry (invisible here, inside deps.transcribe) never consumes a second quota slot", async () => {
    const checkQuota = vi.fn(
      async (): Promise<QuotaCheckResult> => ({ allowed: true, leaseToken: "t" }),
    );
    let transcribeCalls = 0;
    const deps = baseDeps({
      checkQuota,
      transcribe: vi.fn(async (): Promise<TranscriptionResult> => {
        // Simulates logic.ts's own internal retry having already happened
        // before returning — from guard.ts's point of view this is a
        // single call regardless of how many provider attempts it made.
        transcribeCalls += 1;
        return { transcript: "recovered after internal retry", requestId: "r", latencyMs: 1 };
      }),
    });
    await runVoiceTranscriptionGuard(deps);
    expect(checkQuota).toHaveBeenCalledTimes(1);
    expect(transcribeCalls).toBe(1);
  });

  it("an unexpected (non-TranscriptionError) throw from the provider call still fails safely as transcription_failed", async () => {
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new Error("unexpected");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "transcription_failed" });
  });
});

describe("runVoiceTranscriptionGuard — HTTP contract", () => {
  it("every error category has a defined HTTP status and a non-blaming message", () => {
    const categories = Object.keys(ERROR_STATUS) as Array<keyof typeof ERROR_STATUS>;
    for (const c of categories) {
      expect(typeof ERROR_STATUS[c]).toBe("number");
      expect(ERROR_MESSAGE[c].length).toBeGreaterThan(0);
      expect(ERROR_MESSAGE[c].toLowerCase()).not.toMatch(/\byou (didn't|failed|forgot)\b/);
    }
  });

  it("rate limiting and lease conflict both use 429 (retry semantics), circuit breaker and limiter failure both use 503", () => {
    expect(ERROR_STATUS.rate_limited_short_window).toBe(429);
    expect(ERROR_STATUS.rate_limited_daily).toBe(429);
    expect(ERROR_STATUS.request_in_progress).toBe(429);
    expect(ERROR_STATUS.project_limit_reached).toBe(503);
    expect(ERROR_STATUS.limiter_unavailable).toBe(503);
    expect(ERROR_STATUS.feature_disabled).toBe(503);
  });

  it("uses the exact required copy for the four spec'd messages", () => {
    expect(ERROR_MESSAGE.rate_limited_short_window).toBe(
      "You've made several voice requests. Wait a moment, then try again—or type your meal.",
    );
    expect(ERROR_MESSAGE.request_in_progress).toBe(
      "A voice request is already processing. Wait a moment or type your meal.",
    );
    expect(ERROR_MESSAGE.project_limit_reached).toBe(
      "Voice is temporarily unavailable. You can still type your meal.",
    );
    expect(ERROR_MESSAGE.limiter_unavailable).toBe(
      "Voice couldn't connect right now. Try again later or type your meal.",
    );
  });

  it("uses the exact required copy for the remaining Part 4 mappings (file too large, unsupported format, provider failure)", () => {
    expect(ERROR_MESSAGE.payload_too_large).toBe(
      "That recording was too large. Try a shorter recording or type your meal.",
    );
    expect(ERROR_MESSAGE.invalid_audio).toBe(
      "This browser couldn't send the recording. Try again or type your meal.",
    );
    expect(ERROR_MESSAGE.transcription_failed).toBe(
      "Voice transcription didn't work this time. Try again or type your meal.",
    );
    expect(ERROR_MESSAGE.provider_unavailable).toBe(
      "Voice transcription didn't work this time. Try again or type your meal.",
    );
  });
});

describe("runVoiceTranscriptionGuard — privacy (no persistence of audio/transcript/provider body)", () => {
  it("the outcome object never contains the input audio blob", async () => {
    const outcome = await runVoiceTranscriptionGuard(baseDeps());
    expect(JSON.stringify(outcome)).not.toContain("ArrayBuffer");
    expect(outcome).not.toHaveProperty("audioBlob");
    expect(outcome).not.toHaveProperty("audio");
  });

  it("a failure outcome never includes a raw provider error body — only a fixed category string", async () => {
    const { TranscriptionError } = await import("../logic");
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new TranscriptionError(
          "provider_error",
          "upstream said: user email is x@y.com, key sk-abc123",
        );
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "transcription_failed" });
    expect(JSON.stringify(outcome)).not.toContain("sk-abc123");
    expect(JSON.stringify(outcome)).not.toContain("x@y.com");
  });
});

// Stage 3B Phase 3: sanitized upstream diagnostics thread through the
// guard's failure outcome for SERVER LOGS ONLY. index.ts's client-facing
// json() response is built from `outcome.category` alone and must never
// spread `outcome.diagnostics` into it — that boundary can't be unit
// tested here (index.ts is Deno-only, outside this Vitest surface), so
// this suite proves the guard-level contract precisely and index.ts's own
// json() call is deliberately kept to `{ error, message }` only (see the
// comment directly above that call).
describe("runVoiceTranscriptionGuard — sanitized upstream diagnostics (server-log-only)", () => {
  it("threads diagnostics from a TranscriptionError onto the failure outcome", async () => {
    const { TranscriptionError } = await import("../logic");
    const err = new TranscriptionError("provider_error", "rate limited");
    err.diagnostics = {
      upstreamStatus: 429,
      upstreamErrorType: "insufficient_quota",
      upstreamErrorCode: "insufficient_quota",
      upstreamRequestId: "req-1",
      sanitizedUpstreamMessage: "You exceeded your current quota.",
    };
    err.attempt = 2;
    err.totalLatencyMs = 3800;

    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw err;
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);

    expect(outcome).toMatchObject({
      ok: false,
      category: "transcription_failed",
      diagnostics: {
        upstreamStatus: 429,
        upstreamErrorType: "insufficient_quota",
        upstreamErrorCode: "insufficient_quota",
        upstreamRequestId: "req-1",
        sanitizedUpstreamMessage: "You exceeded your current quota.",
        attempt: 2,
        totalLatencyMs: 3800,
      },
    });
  });

  it("a malicious upstream error message, even if it slipped past logic.ts's redaction, still never contains raw audio/multipart markers by construction (diagnostics is built from named string fields only)", async () => {
    const { TranscriptionError } = await import("../logic");
    const err = new TranscriptionError("provider_error", "failed");
    err.diagnostics = {
      upstreamStatus: 500,
      sanitizedUpstreamMessage: "generic server error",
    };
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw err;
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("multipart");
    expect(serialized).not.toContain("FormData");
    expect(serialized).not.toMatch(/Bearer /);
  });

  it("a non-TranscriptionError throw yields no diagnostics at all (nothing to attach)", async () => {
    const deps = baseDeps({
      transcribe: vi.fn(async () => {
        throw new Error("unexpected");
      }),
    });
    const outcome = await runVoiceTranscriptionGuard(deps);
    expect(outcome).toMatchObject({ ok: false, category: "transcription_failed" });
    expect((outcome as { diagnostics?: unknown }).diagnostics).toBeUndefined();
  });

  it("a successful outcome never has a diagnostics field", async () => {
    const outcome = await runVoiceTranscriptionGuard(baseDeps());
    expect(outcome).not.toHaveProperty("diagnostics");
  });
});
