import { describe, it, expect, vi } from "vitest";
import {
  validateAudioInput,
  transcribeAudio,
  TranscriptionError,
  MAX_AUDIO_BYTES,
  OPENAI_TRANSCRIPTIONS_URL,
} from "../logic";

// All OpenAI calls in this file are mocked. Never call the live API from
// the normal test suite.

function fakeAudioBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "audio/webm" });
}

describe("validateAudioInput", () => {
  it("accepts an allowed mime type with a reasonable size", () => {
    expect(() =>
      validateAudioInput({ contentType: "audio/webm;codecs=opus", byteLength: 1024 }),
    ).not.toThrow();
  });

  it("rejects a disallowed mime type", () => {
    try {
      validateAudioInput({ contentType: "video/mp4", byteLength: 1024 });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptionError);
      expect((err as TranscriptionError).category).toBe("unsupported_media_type");
    }
  });

  it("rejects an empty payload", () => {
    try {
      validateAudioInput({ contentType: "audio/webm", byteLength: 0 });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as TranscriptionError).category).toBe("invalid_request");
    }
  });

  it("rejects a payload over the size ceiling", () => {
    try {
      validateAudioInput({ contentType: "audio/webm", byteLength: MAX_AUDIO_BYTES + 1 });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as TranscriptionError).category).toBe("too_large");
    }
  });
});

describe("transcribeAudio", () => {
  it("returns the transcript on a successful single request", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(OPENAI_TRANSCRIPTIONS_URL);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      const form = init.body as FormData;
      expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
      return new Response(JSON.stringify({ text: "Dalawang itlog at isang tasang kanin." }), {
        status: 200,
      });
    });

    const result = await transcribeAudio({
      audioBlob: fakeAudioBlob(),
      contentType: "audio/webm",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.transcript).toBe("Dalawang itlog at isang tasang kanin.");
    expect(result.requestId).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps a 401 to 'unauthorized' with no retry", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("secret leaked details here", { status: 401 }),
    );

    await expect(
      transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "unauthorized" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps a 400 to 'invalid_request' with no retry and never forwards the raw upstream body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("upstream internal detail xyz", { status: 400 }),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ category: "invalid_request" });
    expect((caught as Error).message).not.toContain("upstream internal detail xyz");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 500 and succeeds on the second attempt", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("server error", { status: 500 });
      return new Response(JSON.stringify({ text: "recovered" }), { status: 200 });
    });

    const result = await transcribeAudio({
      audioBlob: fakeAudioBlob(),
      contentType: "audio/webm",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.transcript).toBe("recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails after exactly one retry (bounded, not unbounded) when every attempt 500s", async () => {
    const fetchImpl = vi.fn(async () => new Response("still down", { status: 500 }));

    await expect(
      transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "provider_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out and reports category 'timeout' when the provider never responds", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    await expect(
      transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        timeoutMs: 20,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "timeout" });
  }, 15_000);

  it("does not invent a transcript when the provider response is missing 'text'", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );

    await expect(
      transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "provider_error" });
  });
});

// Stage 3B Phase 3: sanitized upstream diagnostics. Distinguishing
// insufficient_quota / model_not_found / permission_denied / a genuine 5xx
// requires reading OpenAI's documented {error:{type,code,message}} body and
// x-request-id header — the pre-existing code above never did, which is
// exactly what made two real (different-cause) 502s indistinguishable
// during the Stage 3B pilot. These fields are attached to the thrown
// TranscriptionError for SERVER LOGS ONLY — never returned to the client;
// see guard.ts/index.ts for where that boundary is enforced.
describe("transcribeAudio — sanitized upstream diagnostics", () => {
  it("captures upstream status, error.type, error.code and request id on a 429", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "insufficient_quota",
              code: "insufficient_quota",
              message: "You exceeded your current quota.",
            },
          }),
          { status: 429, headers: { "x-request-id": "req-abc-123" } },
        ),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({
      category: "provider_error",
      diagnostics: {
        upstreamStatus: 429,
        upstreamErrorType: "insufficient_quota",
        upstreamErrorCode: "insufficient_quota",
        upstreamRequestId: "req-abc-123",
        sanitizedUpstreamMessage: "You exceeded your current quota.",
      },
    });
  });

  it("captures diagnostics on a 401 (distinguishing invalid_api_key from other unauthorized causes via error.code)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              code: "invalid_api_key",
              message: "Incorrect API key provided.",
            },
          }),
          { status: 401, headers: { "x-request-id": "req-401-xyz" } },
        ),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({
      category: "unauthorized",
      diagnostics: { upstreamStatus: 401, upstreamErrorCode: "invalid_api_key" },
    });
  });

  it("redacts a key-shaped substring inside the upstream error message before it ever reaches diagnostics", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "rejected token sk-FAKEKEYFAKEKEYFAKEKEY1234567890abcdef",
            },
          }),
          { status: 400 },
        ),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    const msg = (caught as { diagnostics?: { sanitizedUpstreamMessage?: string } }).diagnostics
      ?.sanitizedUpstreamMessage;
    expect(msg).toBeDefined();
    expect(msg).not.toContain("sk-FAKEKEYFAKEKEYFAKEKEY1234567890abcdef");
    expect(msg).toContain("[redacted]");
  });

  it("bounds an oversized upstream error message to a fixed length", async () => {
    const hugeMessage = "x".repeat(5000);
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: "server_error", message: hugeMessage } }), {
          status: 500,
        }),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    const msg = (caught as { diagnostics?: { sanitizedUpstreamMessage?: string } }).diagnostics
      ?.sanitizedUpstreamMessage;
    expect(msg).toBeDefined();
    expect(msg!.length).toBeLessThan(250);
  });

  it("never lets a malformed/non-JSON upstream body throw out of diagnostic extraction — falls back to status + request id only", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>not json</html>", {
          status: 502,
          headers: { "x-request-id": "req-html" },
        }),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({
      diagnostics: { upstreamStatus: 502, upstreamRequestId: "req-html" },
    });
    const diag = (caught as { diagnostics?: Record<string, unknown> }).diagnostics;
    expect(diag).not.toHaveProperty("upstreamErrorType");
  });

  it("records the attempt number and total latency on the final thrown error after retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    expect((caught as { attempt?: number }).attempt).toBe(2);
    expect(typeof (caught as { totalLatencyMs?: number }).totalLatencyMs).toBe("number");
  });

  it("diagnostics never contain the raw multipart body, audio bytes, or the request's own Authorization header value", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { type: "server_error", message: "plain failure" } }),
          {
            status: 500,
          },
        ),
    );

    let caught: unknown;
    try {
      await transcribeAudio({
        audioBlob: fakeAudioBlob(),
        contentType: "audio/webm",
        apiKey: "super-secret-test-key-value",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }

    const serialized = JSON.stringify((caught as { diagnostics?: unknown }).diagnostics);
    expect(serialized).not.toContain("super-secret-test-key-value");
    expect(serialized).not.toContain("multipart");
    expect(serialized).not.toContain("FormData");
  });
});
