import { describe, it, expect } from "vitest";
import {
  reduceVoiceState,
  isActiveState,
  canStartNewSession,
  canCancel,
  canStop,
  pickSupportedMimeType,
  isNearEmptyRecording,
  mapServerErrorCategoryToEvent,
  mergeTranscriptIntoInput,
  statusMessageFor,
  ERROR_COPY,
  STATUS_COPY,
  RECORDING_LIMIT_REACHED_MESSAGE,
  ACTIVE_STATES,
  type VoiceState,
} from "../voice-state-machine";

const ALL_STATES: VoiceState[] = [
  "idle",
  "requesting_permission",
  "listening",
  "stopping",
  "transcribing",
  "transcript_ready",
  "permission_denied",
  "permission_blocked",
  "unsupported",
  "no_speech",
  "capture_failed",
  "network_failed",
  "timeout",
  "cancelled",
  "rate_limited",
  "request_in_progress",
  "feature_disabled",
  "limiter_unavailable",
  "invalid_audio",
  "payload_too_large",
  "provider_failed",
];

describe("reduceVoiceState — valid transitions", () => {
  it("idle -> requesting_permission on START_REQUESTED", () => {
    expect(reduceVoiceState("idle", { type: "START_REQUESTED" })).toBe("requesting_permission");
  });

  it("requesting_permission fans out to every detection outcome", () => {
    expect(reduceVoiceState("requesting_permission", { type: "UNSUPPORTED_DETECTED" })).toBe(
      "unsupported",
    );
    expect(reduceVoiceState("requesting_permission", { type: "PERMISSION_BLOCKED_DETECTED" })).toBe(
      "permission_blocked",
    );
    expect(reduceVoiceState("requesting_permission", { type: "PERMISSION_GRANTED" })).toBe(
      "listening",
    );
    expect(reduceVoiceState("requesting_permission", { type: "PERMISSION_DENIED" })).toBe(
      "permission_denied",
    );
    expect(reduceVoiceState("requesting_permission", { type: "CAPTURE_FAILED" })).toBe(
      "capture_failed",
    );
    expect(reduceVoiceState("requesting_permission", { type: "CANCELLED" })).toBe("cancelled");
  });

  it("listening -> stopping on STOP_REQUESTED, or cancelled/capture_failed", () => {
    expect(reduceVoiceState("listening", { type: "STOP_REQUESTED" })).toBe("stopping");
    expect(reduceVoiceState("listening", { type: "CANCELLED" })).toBe("cancelled");
    expect(reduceVoiceState("listening", { type: "CAPTURE_FAILED" })).toBe("capture_failed");
  });

  it("stopping resolves to no_speech, transcribing, cancelled, or capture_failed", () => {
    expect(reduceVoiceState("stopping", { type: "RECORDING_STOPPED_EMPTY" })).toBe("no_speech");
    expect(reduceVoiceState("stopping", { type: "RECORDING_STOPPED_VALID" })).toBe("transcribing");
    expect(reduceVoiceState("stopping", { type: "CANCELLED" })).toBe("cancelled");
    expect(reduceVoiceState("stopping", { type: "CAPTURE_FAILED" })).toBe("capture_failed");
  });

  it("transcribing fans out to every server outcome, including Stage 2.5's distinct rejection categories", () => {
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_SUCCEEDED" })).toBe(
      "transcript_ready",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_NETWORK_FAILED" })).toBe(
      "network_failed",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_TIMED_OUT" })).toBe("timeout");
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_RATE_LIMITED" })).toBe(
      "rate_limited",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_REQUEST_IN_PROGRESS" })).toBe(
      "request_in_progress",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_FEATURE_DISABLED" })).toBe(
      "feature_disabled",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_LIMITER_UNAVAILABLE" })).toBe(
      "limiter_unavailable",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_INVALID_AUDIO" })).toBe(
      "invalid_audio",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_PAYLOAD_TOO_LARGE" })).toBe(
      "payload_too_large",
    );
    expect(reduceVoiceState("transcribing", { type: "TRANSCRIPT_PROVIDER_FAILED" })).toBe(
      "provider_failed",
    );
    expect(reduceVoiceState("transcribing", { type: "CANCELLED" })).toBe("cancelled");
  });

  const terminalStates: VoiceState[] = [
    "permission_denied",
    "permission_blocked",
    "unsupported",
    "no_speech",
    "capture_failed",
    "network_failed",
    "timeout",
    "cancelled",
    "rate_limited",
    "request_in_progress",
    "feature_disabled",
    "limiter_unavailable",
    "invalid_audio",
    "payload_too_large",
    "provider_failed",
  ];

  it("every terminal error/cancelled state accepts RESET -> idle and START_REQUESTED -> requesting_permission (manual retry only)", () => {
    for (const s of terminalStates) {
      expect(reduceVoiceState(s, { type: "RESET" })).toBe("idle");
      expect(reduceVoiceState(s, { type: "START_REQUESTED" })).toBe("requesting_permission");
    }
  });

  it("transcript_ready accepts RESET -> idle", () => {
    expect(reduceVoiceState("transcript_ready", { type: "RESET" })).toBe("idle");
  });
});

describe("reduceVoiceState — deterministic no-ops for invalid events", () => {
  it("ignores STOP_REQUESTED while idle", () => {
    expect(reduceVoiceState("idle", { type: "STOP_REQUESTED" })).toBe("idle");
  });

  it("ignores a second CANCELLED once already cancelled", () => {
    expect(reduceVoiceState("cancelled", { type: "CANCELLED" })).toBe("cancelled");
  });

  it("ignores TRANSCRIPT_SUCCEEDED while listening (out of order)", () => {
    expect(reduceVoiceState("listening", { type: "TRANSCRIPT_SUCCEEDED" })).toBe("listening");
  });

  it("every state has a defined (possibly no-op) result for every event — never throws", () => {
    const allEventTypes = [
      "START_REQUESTED",
      "UNSUPPORTED_DETECTED",
      "PERMISSION_BLOCKED_DETECTED",
      "PERMISSION_GRANTED",
      "PERMISSION_DENIED",
      "CAPTURE_FAILED",
      "STOP_REQUESTED",
      "RECORDING_STOPPED_EMPTY",
      "RECORDING_STOPPED_VALID",
      "TRANSCRIPT_SUCCEEDED",
      "TRANSCRIPT_NETWORK_FAILED",
      "TRANSCRIPT_TIMED_OUT",
      "TRANSCRIPT_RATE_LIMITED",
      "TRANSCRIPT_REQUEST_IN_PROGRESS",
      "TRANSCRIPT_FEATURE_DISABLED",
      "TRANSCRIPT_LIMITER_UNAVAILABLE",
      "TRANSCRIPT_INVALID_AUDIO",
      "TRANSCRIPT_PAYLOAD_TOO_LARGE",
      "TRANSCRIPT_PROVIDER_FAILED",
      "CANCELLED",
      "RESET",
    ] as const;
    for (const s of ALL_STATES) {
      for (const type of allEventTypes) {
        expect(() => reduceVoiceState(s, { type })).not.toThrow();
        expect(ALL_STATES).toContain(reduceVoiceState(s, { type }));
      }
    }
  });
});

describe("active-state guards (duplicate-tap / single-session prevention)", () => {
  it("only requesting_permission/listening/stopping/transcribing count as active", () => {
    expect([...ACTIVE_STATES].sort()).toEqual(
      ["listening", "requesting_permission", "stopping", "transcribing"].sort(),
    );
  });

  it("canStartNewSession is false during any active state, true otherwise", () => {
    for (const s of ALL_STATES) {
      expect(canStartNewSession(s)).toBe(!isActiveState(s));
    }
  });

  it("canCancel mirrors isActiveState", () => {
    for (const s of ALL_STATES) {
      expect(canCancel(s)).toBe(isActiveState(s));
    }
  });

  it("canStop is true only while listening", () => {
    for (const s of ALL_STATES) {
      expect(canStop(s)).toBe(s === "listening");
    }
  });
});

describe("pickSupportedMimeType", () => {
  it("prefers webm/opus when the browser supports it (Android/Chrome path)", () => {
    const isTypeSupported = (t: string) => t === "audio/webm;codecs=opus" || t === "audio/webm";
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to mp4 when webm is unsupported (iOS Safari path)", () => {
    const isTypeSupported = (t: string) => t.startsWith("audio/mp4");
    expect(pickSupportedMimeType(isTypeSupported)).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("returns undefined when nothing is supported", () => {
    expect(pickSupportedMimeType(() => false)).toBeUndefined();
  });
});

describe("isNearEmptyRecording", () => {
  it("flags a zero-byte capture", () => {
    expect(isNearEmptyRecording(0, 5000)).toBe(true);
  });

  it("flags a near-instant tap even with some bytes", () => {
    expect(isNearEmptyRecording(5000, 100)).toBe(true);
  });

  it("accepts a normal short utterance", () => {
    expect(isNearEmptyRecording(20_000, 1500)).toBe(false);
  });
});

describe("mapServerErrorCategoryToEvent — never collapses distinct server categories into one bucket", () => {
  it("maps both timeout spellings to TRANSCRIPT_TIMED_OUT", () => {
    expect(mapServerErrorCategoryToEvent("timeout")).toBe("TRANSCRIPT_TIMED_OUT");
    expect(mapServerErrorCategoryToEvent("transcription_timeout")).toBe("TRANSCRIPT_TIMED_OUT");
  });

  it("maps both rate-limit windows to TRANSCRIPT_RATE_LIMITED", () => {
    expect(mapServerErrorCategoryToEvent("rate_limited_short_window")).toBe(
      "TRANSCRIPT_RATE_LIMITED",
    );
    expect(mapServerErrorCategoryToEvent("rate_limited_daily")).toBe("TRANSCRIPT_RATE_LIMITED");
  });

  it("maps request_in_progress to its own event", () => {
    expect(mapServerErrorCategoryToEvent("request_in_progress")).toBe(
      "TRANSCRIPT_REQUEST_IN_PROGRESS",
    );
  });

  it("maps the kill switch and the circuit breaker to the same feature_disabled event", () => {
    expect(mapServerErrorCategoryToEvent("feature_disabled")).toBe("TRANSCRIPT_FEATURE_DISABLED");
    expect(mapServerErrorCategoryToEvent("project_limit_reached")).toBe(
      "TRANSCRIPT_FEATURE_DISABLED",
    );
  });

  it("maps limiter_unavailable to its own event, distinct from a client-side network failure", () => {
    expect(mapServerErrorCategoryToEvent("limiter_unavailable")).toBe(
      "TRANSCRIPT_LIMITER_UNAVAILABLE",
    );
  });

  it("maps invalid_audio and Stage 1's unsupported_media_type to the same event", () => {
    expect(mapServerErrorCategoryToEvent("invalid_audio")).toBe("TRANSCRIPT_INVALID_AUDIO");
    expect(mapServerErrorCategoryToEvent("unsupported_media_type")).toBe(
      "TRANSCRIPT_INVALID_AUDIO",
    );
  });

  it("maps payload_too_large and Stage 1's too_large to the same event", () => {
    expect(mapServerErrorCategoryToEvent("payload_too_large")).toBe("TRANSCRIPT_PAYLOAD_TOO_LARGE");
    expect(mapServerErrorCategoryToEvent("too_large")).toBe("TRANSCRIPT_PAYLOAD_TOO_LARGE");
  });

  it("falls back to TRANSCRIPT_PROVIDER_FAILED only for genuinely generic/unreachable-in-practice categories", () => {
    for (const c of [
      "unauthorized",
      "provider_error",
      "provider_unavailable",
      "invalid_request",
      "unauthenticated",
      "anything_unrecognized",
    ]) {
      expect(mapServerErrorCategoryToEvent(c)).toBe("TRANSCRIPT_PROVIDER_FAILED");
    }
  });
});

describe("mergeTranscriptIntoInput (typed-text preservation / append behavior)", () => {
  it("inserts the transcript when the input is empty", () => {
    expect(mergeTranscriptIntoInput("", "dalawang itlog")).toBe("dalawang itlog");
  });

  it("inserts the transcript when the input is only whitespace", () => {
    expect(mergeTranscriptIntoInput("   ", "dalawang itlog")).toBe("dalawang itlog");
  });

  it("appends with a single space when text already exists, preserving the existing text verbatim", () => {
    expect(mergeTranscriptIntoInput("100g rice", "and adobo")).toBe("100g rice and adobo");
  });

  it("never drops or mutates the pre-existing typed text", () => {
    const existing = "Some careful typed text  ";
    const result = mergeTranscriptIntoInput(existing, "voice bit");
    expect(result.startsWith(existing)).toBe(true);
  });
});

describe("status/error copy", () => {
  it("has the exact required verbatim copy for the five spec'd error states", () => {
    expect(ERROR_COPY.permission_denied).toBe(
      "Microphone access is off. Enable it in your browser settings or type your meal.",
    );
    expect(ERROR_COPY.no_speech).toBe("I didn't catch anything. Try again or type your meal.");
    expect(ERROR_COPY.network_failed).toBe("Voice couldn't connect. Try again or type your meal.");
    expect(ERROR_COPY.timeout).toBe("Voice took too long. Nothing was saved—please try again.");
    expect(ERROR_COPY.unsupported).toBe(
      "Voice input isn't supported in this browser. You can still type your meal.",
    );
  });

  it("has the exact required Stage 2.5 copy for each distinct rejection category", () => {
    expect(ERROR_COPY.rate_limited).toBe(
      "You've made several voice requests. Wait a moment, then try again—or type your meal.",
    );
    expect(ERROR_COPY.request_in_progress).toBe(
      "A voice request is already processing. Wait a moment or type your meal.",
    );
    expect(ERROR_COPY.feature_disabled).toBe(
      "Voice is temporarily unavailable. You can still type your meal.",
    );
    expect(ERROR_COPY.limiter_unavailable).toBe(
      "Voice couldn't connect right now. Try again later or type your meal.",
    );
    expect(ERROR_COPY.payload_too_large).toBe(
      "That recording was too large. Try a shorter recording or type your meal.",
    );
    expect(ERROR_COPY.invalid_audio).toBe(
      "This browser couldn't send the recording. Try again or type your meal.",
    );
    expect(ERROR_COPY.provider_failed).toBe(
      "Voice transcription didn't work this time. Try again or type your meal.",
    );
    expect(RECORDING_LIMIT_REACHED_MESSAGE).toBe(
      "Voice entries can be up to 20 seconds. Try a shorter description or type your meal.",
    );
  });

  it("no error message exposes internal details (SQL, provider names, exceptions, env vars)", () => {
    const forbidden = /sql|postgres|openai|exception|stack|env|secret|api[_-]?key/i;
    for (const msg of Object.values(ERROR_COPY)) {
      expect(msg).not.toMatch(forbidden);
    }
  });

  it("every non-idle, non-transcript_ready, non-cancelled state resolves to a non-null status message", () => {
    // cancelled is deliberately silent — it's a user-initiated action, not
    // an error, so it gets no toast/aria-live copy.
    for (const s of ALL_STATES) {
      if (s === "idle" || s === "transcript_ready" || s === "cancelled") continue;
      expect(statusMessageFor(s)).toBeTruthy();
    }
  });

  it("required status copy matches exactly for the visible in-progress states", () => {
    expect(STATUS_COPY.requesting_permission).toBe("Starting microphone…");
    expect(STATUS_COPY.listening).toBe("Listening…");
    expect(STATUS_COPY.transcribing).toBe("Processing your voice…");
  });
});
