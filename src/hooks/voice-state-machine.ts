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
  | "provider_failed"
  | "timeout"
  | "cancelled";

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
  | { type: "TRANSCRIPT_PROVIDER_FAILED" }
  | { type: "TRANSCRIPT_TIMED_OUT" }
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
    TRANSCRIPT_PROVIDER_FAILED: "provider_failed",
    TRANSCRIPT_TIMED_OUT: "timeout",
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
  provider_failed: RETRYABLE_TERMINAL,
  timeout: RETRYABLE_TERMINAL,
  cancelled: RETRYABLE_TERMINAL,
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
// Maps Stage 1's TranscriptionErrorCategory (supabase/functions/transcribe-voice/logic.ts)
// down to the 3 failure buckets this state machine distinguishes.
// invalid_request/unsupported_media_type/too_large should never occur given
// Stage 2's own pre-send validation, but if they ever do, "provider_failed"
// is the safe, non-blaming fallback rather than inventing a new state.
export function mapServerErrorCategory(
  category: string,
): "network_failed" | "provider_failed" | "timeout" {
  if (category === "timeout") return "timeout";
  return "provider_failed";
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
  provider_failed: "Voice couldn't be processed right now. Try again or type your meal.",
  timeout: "Voice took too long. Nothing was saved—please try again.",
  unsupported: "Voice input isn't supported in this browser. You can still type your meal.",
  capture_failed: "Couldn't access the microphone. Try again or type your meal.",
};

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
