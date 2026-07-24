// Pure, framework/DOM-agnostic voice-input state machine and helpers.
// No React, no MediaRecorder, no browser globals — everything here is a
// plain function so it can be exhaustively unit tested under plain Node
// (no jsdom needed). The React glue (MediaRecorder/getUserMedia/Supabase
// wiring) lives in ./useVoiceRecorder.ts and delegates every state
// decision to reduceVoiceState below, so behavior is never inferred from
// button styling or ad-hoc booleans.

export type VoiceState =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "stopping"
  | "transcribing"
  | "transcript_ready"
  | "permission_denied"
  | "permission_blocked"
  | "unsupported"
  | "no_speech"
  | "capture_failed"
  | "network_failed"
  | "timeout"
  | "cancelled"
  // Stage 2.5: distinct terminal states for each server-side rejection
  // category the rate limiter/circuit breaker can produce — deliberately
  // NOT collapsed into one generic "provider_failed" bucket, so the user
  // (and tests) can tell "you're being rate limited" apart from "the
  // whole feature is off" apart from "that file was too big".
  | "rate_limited"
  | "request_in_progress"
  | "feature_disabled"
  | "limiter_unavailable"
  | "invalid_audio"
  | "payload_too_large"
  | "provider_failed";

export type VoiceEvent =
  | { type: "START_REQUESTED" }
  | { type: "UNSUPPORTED_DETECTED" }
  | { type: "PERMISSION_BLOCKED_DETECTED" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "PERMISSION_DENIED" }
  | { type: "CAPTURE_FAILED" }
  | { type: "STOP_REQUESTED" }
  | { type: "RECORDING_STOPPED_EMPTY" }
  | { type: "RECORDING_STOPPED_VALID" }
  | { type: "TRANSCRIPT_SUCCEEDED" }
  | { type: "TRANSCRIPT_NETWORK_FAILED" }
  | { type: "TRANSCRIPT_TIMED_OUT" }
  | { type: "TRANSCRIPT_RATE_LIMITED" }
  | { type: "TRANSCRIPT_REQUEST_IN_PROGRESS" }
  | { type: "TRANSCRIPT_FEATURE_DISABLED" }
  | { type: "TRANSCRIPT_LIMITER_UNAVAILABLE" }
  | { type: "TRANSCRIPT_INVALID_AUDIO" }
  | { type: "TRANSCRIPT_PAYLOAD_TOO_LARGE" }
  | { type: "TRANSCRIPT_PROVIDER_FAILED" }
  | { type: "CANCELLED" }
  | { type: "RESET" };

const RETRYABLE_TERMINAL: Partial<Record<VoiceEvent["type"], VoiceState>> = {
  RESET: "idle",
  START_REQUESTED: "requesting_permission",
};

// Explicit transition table: state -> event -> next state. Any event not
// listed for a state is a deliberate no-op (returns the same state) rather
// than an implicit/undefined transition — e.g. STOP_REQUESTED while idle,
// or a second CANCELLED while already cancelled.
const TRANSITIONS: Record<VoiceState, Partial<Record<VoiceEvent["type"], VoiceState>>> = {
  idle: {
    START_REQUESTED: "requesting_permission",
  },
  requesting_permission: {
    UNSUPPORTED_DETECTED: "unsupported",
    PERMISSION_BLOCKED_DETECTED: "permission_blocked",
    PERMISSION_GRANTED: "listening",
    PERMISSION_DENIED: "permission_denied",
    CAPTURE_FAILED: "capture_failed",
    CANCELLED: "cancelled",
  },
  listening: {
    STOP_REQUESTED: "stopping",
    CAPTURE_FAILED: "capture_failed",
    CANCELLED: "cancelled",
  },
  stopping: {
    RECORDING_STOPPED_EMPTY: "no_speech",
    RECORDING_STOPPED_VALID: "transcribing",
    CAPTURE_FAILED: "capture_failed",
    CANCELLED: "cancelled",
  },
  transcribing: {
    TRANSCRIPT_SUCCEEDED: "transcript_ready",
    TRANSCRIPT_NETWORK_FAILED: "network_failed",
    TRANSCRIPT_TIMED_OUT: "timeout",
    TRANSCRIPT_RATE_LIMITED: "rate_limited",
    TRANSCRIPT_REQUEST_IN_PROGRESS: "request_in_progress",
    TRANSCRIPT_FEATURE_DISABLED: "feature_disabled",
    TRANSCRIPT_LIMITER_UNAVAILABLE: "limiter_unavailable",
    TRANSCRIPT_INVALID_AUDIO: "invalid_audio",
    TRANSCRIPT_PAYLOAD_TOO_LARGE: "payload_too_large",
    TRANSCRIPT_PROVIDER_FAILED: "provider_failed",
    CANCELLED: "cancelled",
  },
  // Terminal states: only an explicit RESET or a fresh, user-initiated
  // START_REQUESTED moves out. Nothing here fires on its own — every
  // transition out of a terminal state requires a new event dispatched by
  // an explicit user action, never a timer or a promise resolving on its
  // own. That's what makes "never retry automatically" true by construction.
  transcript_ready: { RESET: "idle" },
  permission_denied: RETRYABLE_TERMINAL,
  permission_blocked: RETRYABLE_TERMINAL,
  unsupported: RETRYABLE_TERMINAL,
  no_speech: RETRYABLE_TERMINAL,
  capture_failed: RETRYABLE_TERMINAL,
  network_failed: RETRYABLE_TERMINAL,
  timeout: RETRYABLE_TERMINAL,
  cancelled: RETRYABLE_TERMINAL,
  rate_limited: RETRYABLE_TERMINAL,
  request_in_progress: RETRYABLE_TERMINAL,
  feature_disabled: RETRYABLE_TERMINAL,
  limiter_unavailable: RETRYABLE_TERMINAL,
  invalid_audio: RETRYABLE_TERMINAL,
  payload_too_large: RETRYABLE_TERMINAL,
  provider_failed: RETRYABLE_TERMINAL,
};

export function reduceVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  return TRANSITIONS[state][event.type] ?? state;
}

export const ACTIVE_STATES: ReadonlySet<VoiceState> = new Set([
  "requesting_permission",
  "listening",
  "stopping",
  "transcribing",
]);

export function isActiveState(state: VoiceState): boolean {
  return ACTIVE_STATES.has(state);
}

export function canStartNewSession(state: VoiceState): boolean {
  return !isActiveState(state);
}

export function canCancel(state: VoiceState): boolean {
  return isActiveState(state);
}

export function canStop(state: VoiceState): boolean {
  return state === "listening";
}

// --- MediaRecorder MIME selection -------------------------------------
// Order matters: Chromium (desktop/Android) reports true for the webm/opus
// candidates and false for the mp4 ones; Safari (macOS/iOS 14.3+) is the
// reverse. Every candidate here normalizes (strips the ;codecs=... suffix)
// to a type already present in Stage 1's ALLOWED_MIME_TYPES allowlist
// (supabase/functions/transcribe-voice/logic.ts), so no server-side change
// was needed for Stage 2.
export const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export function pickSupportedMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  for (const candidate of CANDIDATE_MIME_TYPES) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

// --- Near-empty recording heuristic ------------------------------------
// Not real silence/VAD detection — decoding audio to measure actual speech
// presence is out of scope for Stage 2. This is a deliberately cheap size +
// duration floor that catches accidental instant taps and truly empty
// captures without spending a transcription request on them.
export const MIN_VALID_BYTES = 800;
export const MIN_VALID_DURATION_MS = 300;

export function isNearEmptyRecording(byteLength: number, durationMs: number): boolean {
  return byteLength < MIN_VALID_BYTES || durationMs < MIN_VALID_DURATION_MS;
}

// --- Server error-category mapping --------------------------------------
// Maps every category the transcribe-voice Edge Function's guard.ts can
// return to its own distinct terminal VoiceState — deliberately NOT
// collapsed into one generic bucket (Stage 2.5 correction: an earlier
// version of this function did exactly that, and it was wrong — see the
// Stage 2.5 checkpoint report). "timeout" is Stage 1's original category
// name; "transcription_timeout" is Stage 2.5's rename of the same thing —
// both map to the same client state.
//
// unauthenticated/invalid_request have no dedicated required copy (they
// represent the caller not being signed in, or a malformed request — both
// edge cases that should never occur through the real KainFit UI, since
// the route is already auth-gated and this client always sends a
// well-formed request). They fall back to provider_failed rather than
// inventing new unreachable-in-practice states.
export function mapServerErrorCategoryToEvent(category: string): VoiceEvent["type"] {
  switch (category) {
    case "timeout":
    case "transcription_timeout":
      return "TRANSCRIPT_TIMED_OUT";
    case "rate_limited_short_window":
    case "rate_limited_daily":
      return "TRANSCRIPT_RATE_LIMITED";
    case "request_in_progress":
      return "TRANSCRIPT_REQUEST_IN_PROGRESS";
    case "feature_disabled":
    case "project_limit_reached":
      return "TRANSCRIPT_FEATURE_DISABLED";
    case "limiter_unavailable":
      return "TRANSCRIPT_LIMITER_UNAVAILABLE";
    case "invalid_audio":
    case "unsupported_media_type":
      return "TRANSCRIPT_INVALID_AUDIO";
    case "payload_too_large":
    case "too_large":
      return "TRANSCRIPT_PAYLOAD_TOO_LARGE";
    default:
      // unauthenticated, invalid_request, provider_unavailable,
      // transcription_failed, unauthorized, provider_error, and anything
      // unrecognized all land here — see comment above.
      return "TRANSCRIPT_PROVIDER_FAILED";
  }
}

// --- Timing constants ----------------------------------------------------
export const MAX_RECORDING_MS = 20_000;
export const TRANSCRIBE_TIMEOUT_MS = 20_000;
export const ELAPSED_TICK_MS = 250;

// --- User-facing copy ------------------------------------------------------
// Only permission_denied/no_speech/network_failed/timeout/unsupported were
// given verbatim required copy. permission_blocked reuses permission_denied's
// copy (both are "mic access is off"). capture_failed and provider_failed
// are this implementation's own reasonable extensions, not dictated text —
// flagged here for easy review/adjustment.
export const ERROR_COPY: Partial<Record<VoiceState, string>> = {
  permission_denied:
    "Microphone access is off. Enable it in your browser settings or type your meal.",
  permission_blocked:
    "Microphone access is off. Enable it in your browser settings or type your meal.",
  no_speech: "I didn't catch anything. Try again or type your meal.",
  network_failed: "Voice couldn't connect. Try again or type your meal.",
  timeout: "Voice took too long. Nothing was saved—please try again.",
  unsupported: "Voice input isn't supported in this browser. You can still type your meal.",
  capture_failed: "Couldn't access the microphone. Try again or type your meal.",
  // Stage 2.5 required copy — exact strings, do not reword without re-review.
  rate_limited:
    "You've made several voice requests. Wait a moment, then try again—or type your meal.",
  request_in_progress: "A voice request is already processing. Wait a moment or type your meal.",
  feature_disabled: "Voice is temporarily unavailable. You can still type your meal.",
  limiter_unavailable: "Voice couldn't connect right now. Try again later or type your meal.",
  payload_too_large: "That recording was too large. Try a shorter recording or type your meal.",
  invalid_audio: "This browser couldn't send the recording. Try again or type your meal.",
  provider_failed: "Voice transcription didn't work this time. Try again or type your meal.",
};

// Informational (not an error) copy shown once when the client's own 20s
// recording cap auto-stops the recorder — distinct from an error state,
// since nothing was rejected; the recording proceeds to transcription
// normally right after this fires.
export const RECORDING_LIMIT_REACHED_MESSAGE =
  "Voice entries can be up to 20 seconds. Try a shorter description or type your meal.";

export const STATUS_COPY: Partial<Record<VoiceState, string>> = {
  requesting_permission: "Starting microphone…",
  listening: "Listening…",
  stopping: "Processing your voice…",
  transcribing: "Processing your voice…",
};

export function statusMessageFor(state: VoiceState): string | null {
  return STATUS_COPY[state] ?? ERROR_COPY[state] ?? null;
}

// --- Transcript/input merge behavior ------------------------------------
// Preserves the pre-existing rule from the SpeechRecognition-based
// implementation this replaces: insert into an empty field, otherwise
// append with a single space. Kept pure + exported so it's testable
// without rendering the 1900-line Today page, and reusable by other
// voice-enabled surfaces later.
export function mergeTranscriptIntoInput(existing: string, transcript: string): string {
  const trimmedExisting = existing.trim();
  if (!trimmedExisting) return transcript;
  return `${existing} ${transcript}`;
}
