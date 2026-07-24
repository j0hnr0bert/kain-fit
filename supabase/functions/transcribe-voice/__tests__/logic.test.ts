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
