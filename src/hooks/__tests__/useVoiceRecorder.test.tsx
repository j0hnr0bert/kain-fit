// @vitest-environment jsdom
//
// Hook-level lifecycle tests. Mocks MediaRecorder/getUserMedia/Permissions
// API/supabase.functions.invoke — this proves the hook's own orchestration
// logic (event ordering, cleanup, guards) is correct under simulated
// browser APIs. It does NOT and cannot prove real iPhone/Android
// microphone behavior; that requires the manual real-device pass called
// out separately in the sprint's outstanding blockers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoiceRecorder } from "../useVoiceRecorder";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

class FakeTrack {
  stop = vi.fn();
  kind = "audio";
}

class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = [new FakeTrack()]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

type DataHandler = (e: { data: Blob }) => void;

class FakeMediaRecorder {
  static supportedTypes: Set<string> = new Set();
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supportedTypes.has(type);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  stream: FakeStream;
  ondataavailable: DataHandler | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(stream: FakeStream, opts?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }
  emitData(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

function installBrowserMocks(opts?: {
  getUserMediaImpl?: () => Promise<FakeStream>;
  permissionsState?: "granted" | "denied" | "prompt" | "unsupported";
  supportedMimeTypes?: string[];
  streamTracks?: FakeTrack[];
}) {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(
    opts?.supportedMimeTypes ?? ["audio/webm;codecs=opus", "audio/webm"],
  );
  const getUserMedia =
    opts?.getUserMediaImpl ?? vi.fn(async () => new FakeStream(opts?.streamTracks));
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
    permissions:
      opts?.permissionsState === "unsupported"
        ? undefined
        : {
            query: vi.fn(async () => ({ state: opts?.permissionsState ?? "prompt" })),
          },
  });
  return { getUserMedia };
}

// The hook treats a recording shorter than MIN_VALID_DURATION_MS (300ms) as
// near-empty and routes it to no_speech instead of transcribing — correct
// production behavior, but it means lifecycle tests that want to reach
// "transcribing" must let real wall-clock time pass between starting the
// recording and calling stop(), same as a real user would.
async function passDurationGate() {
  await new Promise((r) => setTimeout(r, 350));
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useVoiceRecorder — support detection", () => {
  it("reports unsupported and never calls getUserMedia when MediaRecorder is missing", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", undefined);

    const { result } = renderHook(() => useVoiceRecorder());
    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe("unsupported"));
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("useVoiceRecorder — permission handling", () => {
  it("goes straight to listening when permission is already granted", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    expect(result.current.isActive).toBe(true);
  });

  it("maps a NotAllowedError from getUserMedia to permission_denied", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    installBrowserMocks({
      permissionsState: "prompt",
      getUserMediaImpl: vi.fn().mockRejectedValue(err),
    });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("permission_denied"));
  });

  it("detects a pre-blocked permission via the Permissions API and skips getUserMedia entirely", async () => {
    const { getUserMedia } = installBrowserMocks({ permissionsState: "denied" });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("permission_blocked"));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("falls back to permission_denied (not permission_blocked) when the Permissions API is unavailable, e.g. Safari", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    installBrowserMocks({
      permissionsState: "unsupported",
      getUserMediaImpl: vi.fn().mockRejectedValue(err),
    });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("permission_denied"));
  });

  it("never retries a denied permission automatically — state stays put until the next explicit start()", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const getUserMediaImpl = vi.fn().mockRejectedValue(err);
    installBrowserMocks({ permissionsState: "prompt", getUserMediaImpl });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("permission_denied"));
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);

    // No automatic follow-up call after the failure settles.
    await new Promise((r) => setTimeout(r, 20));
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);
  });
});

describe("useVoiceRecorder — MIME selection", () => {
  it("selects the Android/Chrome webm+opus candidate when supported", async () => {
    installBrowserMocks({
      permissionsState: "granted",
      supportedMimeTypes: ["audio/webm;codecs=opus", "audio/webm"],
    });
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("selects the iOS Safari mp4 candidate when webm is unsupported", async () => {
    installBrowserMocks({
      permissionsState: "granted",
      supportedMimeTypes: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
    });
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
  });
});

describe("useVoiceRecorder — recording lifecycle", () => {
  it("manual stop moves through stopping into transcribing and calls invoke once", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    invokeMock.mockResolvedValue({
      data: { transcript: "itlog", requestId: "r1", latencyMs: 10 },
      error: null,
    });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));

    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());
    expect(result.current.state).toBe("transcribing");

    await waitFor(() => expect(result.current.state).toBe("transcript_ready"));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("transcribe-voice");
  });

  it("auto-stops at 20 seconds without a manual stop() call", async () => {
    vi.useFakeTimers();
    installBrowserMocks({ permissionsState: "granted" });
    invokeMock.mockResolvedValue({
      data: { transcript: "x", requestId: "r", latencyMs: 1 },
      error: null,
    });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("listening");

    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(recorder.state).toBe("inactive"); // recorder.stop() was called by the auto-stop timer
  });

  it("displays elapsed recording time while listening", async () => {
    vi.useFakeTimers();
    installBrowserMocks({ permissionsState: "granted" });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.elapsedMs).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(750);
  });

  it("ignores an empty/near-instant recording as no_speech and never calls invoke", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    // No emitData() and no duration gate — zero bytes, near-instant tap.
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("no_speech"));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("useVoiceRecorder — cancel", () => {
  it("cancel during listening discards audio, stops tracks, and never calls transcription", async () => {
    const track = new FakeTrack();
    installBrowserMocks({ permissionsState: "granted", streamTracks: [track] });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));

    act(() => result.current.cancel());
    expect(result.current.state).toBe("cancelled");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("cancel during transcribing aborts the in-flight request via AbortController", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    let capturedSignal: AbortSignal | undefined;
    invokeMock.mockImplementation(
      (_name: string, opts: { signal?: AbortSignal }) =>
        new Promise(() => {
          capturedSignal = opts.signal;
        }),
    );
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());
    expect(result.current.state).toBe("transcribing");
    expect(capturedSignal?.aborted).toBe(false);

    act(() => result.current.cancel());
    expect(result.current.state).toBe("cancelled");
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("rejects a stale response: cancelling then finishing a superseded request does not flip state back", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    let resolveInvoke: (v: unknown) => void = () => {};
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());
    expect(result.current.state).toBe("transcribing");

    act(() => result.current.cancel());
    expect(result.current.state).toBe("cancelled");

    // The old, cancelled request resolves late — must be ignored.
    await act(async () => {
      resolveInvoke({ data: { transcript: "late", requestId: "old", latencyMs: 1 }, error: null });
      await Promise.resolve();
    });
    expect(result.current.state).toBe("cancelled");
  });
});

describe("useVoiceRecorder — duplicate-tap / single-session guard", () => {
  it("a second start() while already listening is a no-op", async () => {
    const { getUserMedia } = installBrowserMocks({ permissionsState: "granted" });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    act(() => result.current.start());
    act(() => result.current.start());

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });
});

describe("useVoiceRecorder — transcription failure mapping", () => {
  it("maps a network-level invoke failure (no response) to network_failed", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "fetch failed" },
      response: undefined,
    });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("network_failed"));
  });

  it("maps a provider-category server error to provider_failed", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    const response = new Response(JSON.stringify({ error: "provider_error" }), { status: 502 });
    invokeMock.mockResolvedValue({ data: null, error: { context: response } });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("provider_failed"));
  });

  it("maps the server's own timeout category to the timeout state", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    const response = new Response(JSON.stringify({ error: "timeout" }), { status: 504 });
    invokeMock.mockResolvedValue({ data: null, error: { context: response } });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("timeout"));
  });

  it("reaches the client-side transcription timeout when the provider never responds, capped at one client call (Stage 1 owns its own 2-attempt bound internally)", async () => {
    vi.useFakeTimers();
    installBrowserMocks({ permissionsState: "granted" });
    // supabase.functions.invoke never rejects (it catches internally) — a
    // real aborted call resolves with { data: null, error } where
    // error.context is the raw AbortError. Mirror that shape here rather
    // than rejecting, since the hook's abort detection reads error.context.
    invokeMock.mockImplementation(
      (_name: string, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener("abort", () =>
            resolve({ data: null, error: { context: { name: "AbortError" } } }),
          );
        }),
    );
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    act(() => result.current.stop());
    expect(result.current.state).toBe("transcribing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.state).toBe("timeout");
    expect(invokeMock).toHaveBeenCalledTimes(1); // one client call; Stage 1's own 2-attempt bound is internal to that call
  });
});

describe("useVoiceRecorder — input integrity (no auto-submit/save)", () => {
  it("calls onTranscriptReady exactly once with the raw transcript, and touches no other API", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    invokeMock.mockResolvedValue({
      data: { transcript: "dalawang itlog", requestId: "r1", latencyMs: 5 },
      error: null,
    });
    const onTranscriptReady = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onTranscriptReady }));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state).toBe("transcript_ready"));
    expect(onTranscriptReady).toHaveBeenCalledTimes(1);
    expect(onTranscriptReady).toHaveBeenCalledWith("dalawang itlog");
    // Only the transcription call happened — nothing resembling a save/submit.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reset() returns to idle without re-invoking onTranscriptReady", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    invokeMock.mockResolvedValue({
      data: { transcript: "x", requestId: "r", latencyMs: 1 },
      error: null,
    });
    const onTranscriptReady = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onTranscriptReady }));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state).toBe("transcript_ready"));

    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(onTranscriptReady).toHaveBeenCalledTimes(1);
  });
});

describe("useVoiceRecorder — cleanup", () => {
  it("releases the microphone stream as soon as recording stops, before transcription even resolves", async () => {
    const track = new FakeTrack();
    installBrowserMocks({ permissionsState: "granted", streamTracks: [track] });
    let resolveInvoke: (v: unknown) => void = () => {};
    invokeMock.mockImplementation(() => new Promise((resolve) => (resolveInvoke = resolve)));
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));
    const recorder = FakeMediaRecorder.instances[0];
    act(() => recorder.emitData(5000));
    await passDurationGate();
    act(() => result.current.stop());

    expect(result.current.state).toBe("transcribing");
    expect(track.stop).toHaveBeenCalledTimes(1); // released even though transcription hasn't resolved yet

    await act(async () => {
      resolveInvoke({ data: { transcript: "x", requestId: "r", latencyMs: 1 }, error: null });
      await Promise.resolve();
    });
  });

  it("cleans up on unmount while actively listening: tracks stopped, no further state change", async () => {
    const track = new FakeTrack();
    installBrowserMocks({ permissionsState: "granted", streamTracks: [track] });
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("stops an active session when the tab is backgrounded (visibilitychange)", async () => {
    installBrowserMocks({ permissionsState: "granted" });
    const { result } = renderHook(() => useVoiceRecorder());

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("listening"));

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(result.current.state).toBe("cancelled");
  });

  it("cleans up on every error terminal state: permission_denied leaves no active session behind", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    installBrowserMocks({
      permissionsState: "prompt",
      getUserMediaImpl: vi.fn().mockRejectedValue(err),
    });
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("permission_denied"));
    expect(result.current.isActive).toBe(false);
  });
});
