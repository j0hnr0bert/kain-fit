// Request-processing orchestration for transcribe-voice, Stage 2.5.
// Implements the exact 15-step order from the sprint spec, with every
// browser/Deno/Postgres dependency injected so this file is fully
// unit-testable under Vitest/Node (mirrors the Stage 1 logic.ts/index.ts
// split). index.ts wires the real Supabase/Deno dependencies in.
//
// Steps 7 and 8 (quota check, lease acquire) are combined into a single
// atomic database call (checkQuota) rather than two separate round-trips —
// see the migration's comment on acquire_voice_transcription_slot for why
// that is *more* correct, not a shortcut: two separate calls would reopen
// a race between "quota granted" and "lease acquired" unless both were
// wrapped in the same lock anyway, so there is no less-atomic version of
// this that is also simpler.

import {
  transcribeAudio,
  validateAudioInput,
  TranscriptionError,
  MAX_AUDIO_BYTES,
  type TranscriptionResult,
  type TranscriptionErrorCategory,
} from "./logic.ts";

// Server-side backstop mirroring the client's MIN_VALID_BYTES heuristic
// (src/hooks/voice-state-machine.ts) — kept as an independent constant
// since this Deno module cannot import that browser-side file.
const MIN_SERVER_AUDIO_BYTES = 800;

export type VoiceGuardErrorCategory =
  | "feature_disabled"
  | "unauthenticated"
  | "invalid_request"
  | "invalid_audio"
  | "payload_too_large"
  | "rate_limited_short_window"
  | "rate_limited_daily"
  | "project_limit_reached"
  | "request_in_progress"
  | "limiter_unavailable"
  | "transcription_timeout"
  | "provider_unavailable"
  | "transcription_failed";

export const ERROR_STATUS: Record<VoiceGuardErrorCategory, number> = {
  feature_disabled: 503,
  unauthenticated: 401,
  invalid_request: 400,
  invalid_audio: 415,
  payload_too_large: 413,
  rate_limited_short_window: 429,
  rate_limited_daily: 429,
  // 429 (not 409): this is "you're sending requests faster than allowed,
  // back off and retry" — the same semantics and the same Retry-After
  // mechanism as the other rate-limit responses. 409 Conflict better fits
  // a resource-state disagreement (e.g. an edit conflict), not "wait and
  // retry the same request", so one consistent status code covers all of
  // this endpoint's "back off" cases instead of splitting the client's
  // handling across two.
  request_in_progress: 429,
  project_limit_reached: 503,
  limiter_unavailable: 503,
  transcription_timeout: 504,
  provider_unavailable: 502,
  transcription_failed: 502,
};

// Only the 5 states given verbatim copy, plus this stage's own additions,
// are filled in here; the rest reuse the closest match rather than
// inventing new blame-y language. Server-side copy is metadata for
// operators/logs — the client (src/hooks/voice-state-machine.ts) has its
// own copy for what the user actually sees, kept in sync separately.
// Kept byte-for-byte in sync with the client's ERROR_COPY
// (src/hooks/voice-state-machine.ts) wherever Part 4 of the Stage 2.5 spec
// gave exact required wording, so a reader never has to wonder whether the
// two ends agree. The client never actually reads this `message` field
// today (only the `error` category) — this exists for any other consumer
// of the API and for operators reading logs, not as the client's copy
// source of truth.
export const ERROR_MESSAGE: Record<VoiceGuardErrorCategory, string> = {
  feature_disabled: "Voice is temporarily unavailable. You can still type your meal.",
  unauthenticated: "You need to be signed in to use voice input.",
  invalid_request: "Couldn't read that voice request. Try again or type your meal.",
  invalid_audio: "This browser couldn't send the recording. Try again or type your meal.",
  payload_too_large: "That recording was too large. Try a shorter recording or type your meal.",
  rate_limited_short_window:
    "You've made several voice requests. Wait a moment, then try again—or type your meal.",
  rate_limited_daily:
    "You've made several voice requests. Wait a moment, then try again—or type your meal.",
  request_in_progress: "A voice request is already processing. Wait a moment or type your meal.",
  project_limit_reached: "Voice is temporarily unavailable. You can still type your meal.",
  limiter_unavailable: "Voice couldn't connect right now. Try again later or type your meal.",
  transcription_timeout: "Voice took too long. Nothing was saved—please try again.",
  provider_unavailable: "Voice transcription didn't work this time. Try again or type your meal.",
  transcription_failed: "Voice transcription didn't work this time. Try again or type your meal.",
};

export type QuotaFailureReason =
  | "unauthenticated"
  | "request_in_progress"
  | "rate_limited_short_window"
  | "rate_limited_daily"
  | "project_limit_reached";

export type QuotaCheckResult =
  | { allowed: true; leaseToken: string }
  | { allowed: false; reason: QuotaFailureReason; retryAfterSeconds?: number };

export interface VoiceGuardDeps {
  isFeatureEnabled: boolean;
  method: string;
  // Resolves the VERIFIED authenticated user id (e.g. via
  // supabase.auth.getUser() against the caller's own JWT) — never a
  // client-supplied field from the request body/headers. Returns null if
  // auth cannot be verified.
  getVerifiedUserId: () => Promise<string | null>;
  contentType: string;
  declaredContentLength: number | null;
  // Atomic quota+lease acquire (steps 7+8). Must never be called with a
  // client-supplied user id — only the value getVerifiedUserId() returned.
  checkQuota: (userId: string) => Promise<QuotaCheckResult>;
  // Best-effort; failures here must never surface to the caller or block
  // the response — the lease self-expires regardless (see migration).
  releaseLease: (userId: string, leaseToken: string) => Promise<void>;
  readBody: () => Promise<Blob>;
  transcribe: (audioBlob: Blob, contentType: string) => Promise<TranscriptionResult>;
}

export interface VoiceGuardSuccess {
  ok: true;
  result: TranscriptionResult;
}

export interface VoiceGuardFailure {
  ok: false;
  category: VoiceGuardErrorCategory;
  retryAfterSeconds?: number;
}

export type VoiceGuardOutcome = VoiceGuardSuccess | VoiceGuardFailure;

export async function runVoiceTranscriptionGuard(deps: VoiceGuardDeps): Promise<VoiceGuardOutcome> {
  // 1. Emergency kill switch.
  if (!deps.isFeatureEnabled) {
    return { ok: false, category: "feature_disabled" };
  }

  // 2. HTTP method.
  if (deps.method !== "POST") {
    // method_not_allowed isn't in the required category list; index.ts
    // handles this before ever calling the guard (see index.ts), so this
    // branch only exists to keep the guard's own contract total/safe.
    return { ok: false, category: "invalid_request" };
  }

  // 3 & 4. Authentication + derive verified identity. Never trust a
  // client-supplied user id (threat: forged client user IDs) — the only
  // identity this function ever sees is whatever getVerifiedUserId()
  // resolves from the caller's own verified auth context.
  let userId: string | null;
  try {
    userId = await deps.getVerifiedUserId();
  } catch {
    userId = null;
  }
  if (!userId) {
    return { ok: false, category: "unauthenticated" };
  }

  // 5. Reject impossible/oversized declared Content-Length before reading
  // the full body. Cheap check, runs before quota is ever touched — an
  // attacker sending obviously-bad headers doesn't cost a quota slot.
  if (
    deps.declaredContentLength === null ||
    !Number.isFinite(deps.declaredContentLength) ||
    deps.declaredContentLength <= 0
  ) {
    return { ok: false, category: "invalid_request" };
  }
  if (deps.declaredContentLength > MAX_AUDIO_BYTES) {
    return { ok: false, category: "payload_too_large" };
  }

  // 6. Request identifier format validation — not applicable. Stage 2's
  // client generates a request id for its OWN client-side stale-response
  // handling only; it is never sent to this endpoint, and per this
  // stage's own security principle a client-supplied id could never be
  // trusted as a security/replay boundary anyway (threat: a caller
  // hitting this endpoint directly, outside the KainFit UI, could send
  // any id it likes). Duplicate/concurrent server-side calls are instead
  // prevented by the active-request lease (step 8) and the atomic
  // per-user quota window (step 7) — both server-verified, not client-
  // supplied. See the "IDEMPOTENCY AND REPLAY" section of this stage's
  // report for the full explanation.

  // 7 & 8. Atomic quota check + lease acquire, in one database call.
  let quota: QuotaCheckResult;
  try {
    quota = await deps.checkQuota(userId);
  } catch {
    // Fail closed: a limiter failure must never fall back to "allow".
    return { ok: false, category: "limiter_unavailable" };
  }
  if (!quota.allowed) {
    // QuotaCheckResult's failure reasons are already spelled identically
    // to VoiceGuardErrorCategory's members — no translation needed.
    return {
      ok: false,
      category: quota.reason,
      retryAfterSeconds: quota.retryAfterSeconds,
    };
  }
  const leaseToken = quota.leaseToken;

  try {
    // 9. Read and validate the actual body size.
    const audioBlob = await deps.readBody();
    try {
      // 10. MIME type (validateAudioInput — see logic.ts).
      validateAudioInput({ contentType: deps.contentType, byteLength: audioBlob.size });
    } catch (err) {
      if (err instanceof TranscriptionError) {
        return {
          ok: false,
          category: mapTranscriptionErrorCategory(err.category),
        };
      }
      throw err;
    }
    // 11. Reject near-empty payloads. Stage 1's validateAudioInput only
    // rejects a truly-empty (0-byte) body; the client's own near-empty
    // heuristic (isNearEmptyRecording in voice-state-machine.ts) never
    // reaches this endpoint at all for the normal UI path. This floor is
    // defense-in-depth against threat #7 (a caller hitting this endpoint
    // directly, outside the KainFit UI, with a trivial non-empty payload)
    // — without it, a 1-byte body would pass validateAudioInput, consume
    // a quota slot, and still be forwarded to OpenAI at real cost.
    if (audioBlob.size < MIN_SERVER_AUDIO_BYTES) {
      return { ok: false, category: "invalid_audio" };
    }

    // 12. Call OpenAI with bounded timeout and retry (Stage 1, unchanged —
    // still capped at 2 total provider attempts per client request).
    try {
      const result = await deps.transcribe(audioBlob, deps.contentType);
      return { ok: true, result };
    } catch (err) {
      if (err instanceof TranscriptionError) {
        return { ok: false, category: mapTranscriptionErrorCategory(err.category) };
      }
      return { ok: false, category: "transcription_failed" };
    }
  } finally {
    // 13. Release the lease in finally, regardless of outcome above.
    try {
      await deps.releaseLease(userId, leaseToken);
    } catch {
      // Best-effort only — the lease self-expires (see migration).
    }
  }
  // 14 (return transcript or safe categorized error) and 15 (never
  // persist audio/transcript/provider response) are satisfied by
  // construction: every return above is either a TranscriptionResult or
  // a category string, and nothing in this file ever writes audioBlob,
  // the transcript, or a raw provider body anywhere.
}

function mapTranscriptionErrorCategory(
  category: TranscriptionErrorCategory,
): VoiceGuardErrorCategory {
  switch (category) {
    case "invalid_request":
      return "invalid_request";
    case "unsupported_media_type":
      return "invalid_audio";
    case "too_large":
      return "payload_too_large";
    case "timeout":
      return "transcription_timeout";
    case "unauthorized":
      // Stage 1's "unauthorized" means OpenAI rejected OUR server
      // credentials — a provider-side problem, not the caller's. Must not
      // be confused with this stage's own "unauthenticated" (the KainFit
      // user isn't signed in), which is derived independently above.
      return "provider_unavailable";
    case "provider_unavailable":
      return "provider_unavailable";
    case "provider_error":
      return "transcription_failed";
  }
}
