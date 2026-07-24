// Reusable client-side voice-input hook: MediaRecorder capture -> Stage 1's
// `transcribe-voice` Supabase Edge Function -> editable transcript. Every
// state decision is delegated to reduceVoiceState (./voice-state-machine.ts)
// so behavior is never inferred from a boolean or from button styling.
//
// This hook never submits, parses, or saves anything — it only ever calls
// onTranscriptReady with the raw transcript text. The caller (e.g. Today's
// existing form) decides what to do with it through its own, already-
// reviewed submit flow.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  type VoiceState,
  type VoiceEvent,
  reduceVoiceState,
  isActiveState,
  canCancel,
  canStop,
  pickSupportedMimeType,
  isNearEmptyRecording,
  mapServerErrorCategoryToEvent,
  statusMessageFor,
  MAX_RECORDING_MS,
  TRANSCRIBE_TIMEOUT_MS,
  ELAPSED_TICK_MS,
} from "./voice-state-machine";

export type { VoiceState } from "./voice-state-machine";
export {
  ERROR_COPY,
  STATUS_COPY,
  RECORDING_LIMIT_REACHED_MESSAGE,
  mergeTranscriptIntoInput,
  statusMessageFor,
} from "./voice-state-machine";

interface TranscribeResponse {
  transcript: string;
  requestId: string;
  latencyMs: number;
}

export interface UseVoiceRecorderOptions {
  // Stage 3 hook only. Never set by any Stage 2 call site — accepting it
  // now means Stage 3 doesn't need to touch this file's signature later.
  // When set, forwarded to the edge function as a `language` query param
  // (already read by supabase/functions/transcribe-voice/index.ts); no
  // Stage 1 change was needed for this to work.
  languageMode?: string;
  onTranscriptReady?: (transcript: string) => void;
}

export interface UseVoiceRecorderResult {
  state: VoiceState;
  isActive: boolean;
  elapsedMs: number;
  statusMessage: string | null;
  isSupported: boolean;
  // True for exactly the recording that was cut off by the 20s cap —
  // see RECORDING_LIMIT_REACHED_MESSAGE. Cleared on the next start().
  autoStoppedAtLimit: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
}

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof MediaRecorder !== "undefined" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

async function detectPermissionBlocked(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      permissions?: { query: (opts: { name: string }) => Promise<{ state: string }> };
    };
    if (!nav.permissions?.query) return false; // Safari: unsupported, not distinguishable
    const status = await nav.permissions.query({ name: "microphone" });
    return status.state === "denied";
  } catch {
    return false;
  }
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): UseVoiceRecorderResult {
  const { languageMode, onTranscriptReady } = options;
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isSupported] = useState(detectSupport);
  // True for exactly the recording that was cut off by the 20s auto-stop
  // timer (not a manual Stop tap) — lets the caller show the "up to 20
  // seconds" informational message exactly once, at the moment it's true.
  const [autoStoppedAtLimit, setAutoStoppedAtLimit] = useState(false);

  const stateRef = useRef<VoiceState>(state);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const cancelledDuringRecordingRef = useRef(false);
  const abortReasonRef = useRef<"cancel" | "timeout" | null>(null);
  const mountedRef = useRef(true);

  const dispatch = useCallback((event: VoiceEvent) => {
    setState((prev) => reduceVoiceState(prev, event));
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearTimers = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (transcribeTimeoutRef.current) {
      clearTimeout(transcribeTimeoutRef.current);
      transcribeTimeoutRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const fullCleanup = useCallback(() => {
    clearTimers();
    releaseStream();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // already inactive/unsupported transition — nothing to do
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current = null;
  }, [clearTimers, releaseStream]);

  const transcribe = useCallback(
    async (blob: Blob, mimeType: string) => {
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      abortReasonRef.current = null;
      transcribeTimeoutRef.current = setTimeout(() => {
        abortReasonRef.current = "timeout";
        controller.abort();
      }, TRANSCRIBE_TIMEOUT_MS);

      const functionName = languageMode
        ? `transcribe-voice?language=${encodeURIComponent(languageMode)}`
        : "transcribe-voice";

      try {
        const { data, error } = await supabase.functions.invoke<TranscribeResponse>(functionName, {
          body: blob,
          headers: { "Content-Type": mimeType },
          signal: controller.signal,
        });

        // Stale/superseded: a cancel() or a brand-new session already moved
        // state on — never let a late response overwrite it.
        if (requestIdRef.current !== requestId || !mountedRef.current) return;

        if (error) {
          const isAbort =
            (error as { name?: string })?.name === "AbortError" ||
            (error as { context?: { name?: string } })?.context?.name === "AbortError";
          if (isAbort) {
            if (abortReasonRef.current === "timeout") {
              dispatch({ type: "TRANSCRIPT_TIMED_OUT" });
            }
            // reason "cancel": cancel() already dispatched CANCELLED.
            return;
          }
          const response = (error as { context?: Response }).context;
          if (response && typeof response.json === "function") {
            const body = await response.json().catch(() => null);
            const category = typeof body?.error === "string" ? body.error : "provider_error";
            dispatch({ type: mapServerErrorCategoryToEvent(category) });
          } else {
            dispatch({ type: "TRANSCRIPT_NETWORK_FAILED" });
          }
          return;
        }

        if (!data || typeof data.transcript !== "string") {
          dispatch({ type: "TRANSCRIPT_PROVIDER_FAILED" });
          return;
        }

        dispatch({ type: "TRANSCRIPT_SUCCEEDED" });
        onTranscriptReady?.(data.transcript);
      } finally {
        if (transcribeTimeoutRef.current) {
          clearTimeout(transcribeTimeoutRef.current);
          transcribeTimeoutRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          abortControllerRef.current = null;
          requestIdRef.current = null;
        }
      }
    },
    [dispatch, onTranscriptReady, languageMode],
  );

  const stop = useCallback(
    (reason: "manual" | "auto_limit" = "manual") => {
      if (!canStop(stateRef.current)) return;
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (reason === "auto_limit") setAutoStoppedAtLimit(true);
      dispatch({ type: "STOP_REQUESTED" });
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore — recorder already stopped/inactive
      }
    },
    [dispatch],
  );

  const cancel = useCallback(() => {
    if (!canCancel(stateRef.current)) return;
    clearTimers();
    abortReasonRef.current = "cancel";
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      cancelledDuringRecordingRef.current = true;
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    releaseStream();
    chunksRef.current = [];
    recorderRef.current = null;
    dispatch({ type: "CANCELLED" });
  }, [clearTimers, releaseStream, dispatch]);

  const beginSession = useCallback(async () => {
    // Always enter requesting_permission first — every detection outcome
    // below (unsupported/blocked/granted/denied) is a transition *out of*
    // that state, per the table in voice-state-machine.ts. Dispatching a
    // detection event while still in idle would be a no-op there.
    dispatch({ type: "START_REQUESTED" });

    if (!isSupported) {
      dispatch({ type: "UNSUPPORTED_DETECTED" });
      return;
    }

    const blocked = await detectPermissionBlocked();
    if (!mountedRef.current) return;
    if (blocked) {
      dispatch({ type: "PERMISSION_BLOCKED_DETECTED" });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (!mountedRef.current) return;
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        dispatch({ type: "PERMISSION_DENIED" });
      } else {
        dispatch({ type: "CAPTURE_FAILED" });
      }
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    const mimeType = pickSupportedMimeType((t) =>
      typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported(t) : false,
    );

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      releaseStream();
      dispatch({ type: "CAPTURE_FAILED" });
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledDuringRecordingRef.current = false;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      releaseStream();
      chunksRef.current = [];
      recorderRef.current = null;
      clearTimers();
      dispatch({ type: "CAPTURE_FAILED" });
    };
    recorder.onstop = () => {
      releaseStream(); // mic indicator off immediately, before/independent of transcription
      const wasCancelled = cancelledDuringRecordingRef.current;
      cancelledDuringRecordingRef.current = false;
      const finalMimeType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: finalMimeType });
      const durationMs = Date.now() - startedAtRef.current;
      chunksRef.current = [];
      recorderRef.current = null;
      if (wasCancelled) return; // cancel() already dispatched + cleaned up
      if (isNearEmptyRecording(blob.size, durationMs)) {
        dispatch({ type: "RECORDING_STOPPED_EMPTY" });
        return;
      }
      dispatch({ type: "RECORDING_STOPPED_VALID" });
      void transcribe(blob, finalMimeType);
    };

    recorder.start();
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    dispatch({ type: "PERMISSION_GRANTED" }); // -> listening

    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, ELAPSED_TICK_MS);
    autoStopTimerRef.current = setTimeout(() => {
      stop("auto_limit");
    }, MAX_RECORDING_MS);
  }, [dispatch, releaseStream, clearTimers, stop, transcribe, isSupported]);

  const start = useCallback(() => {
    if (isActiveState(stateRef.current)) return; // duplicate-tap guard
    setAutoStoppedAtLimit(false);
    void beginSession();
  }, [beginSession]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setElapsedMs(0);
  }, [dispatch]);

  // Unmount cleanup — also covers route changes away from the page, since
  // TanStack Router unmounts the leaf route component on navigation.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fullCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backgrounding: tab hidden or page being unloaded mid-session. Treated as
  // a cancel (discard, no transcription), not a capture failure — the user
  // didn't do anything wrong, the environment interrupted them.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisibilityChange() {
      if (document.hidden && isActiveState(stateRef.current)) cancel();
    }
    function onPageHide() {
      if (isActiveState(stateRef.current)) cancel();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [cancel]);

  return {
    state,
    isActive: isActiveState(state),
    elapsedMs,
    statusMessage: statusMessageFor(state),
    isSupported,
    autoStoppedAtLimit,
    start,
    stop,
    cancel,
    reset,
  };
}
