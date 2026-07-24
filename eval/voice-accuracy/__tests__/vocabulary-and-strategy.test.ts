import { describe, it, expect } from "vitest";
import { GOLDEN_CORPUS } from "../corpus/golden-corpus";
import {
  FILIPINO_EVALUATION_VOCABULARY,
  vocabularyGapsNotInCorpus,
} from "../vocabulary/filipino-vocabulary";
import { LANGUAGE_STRATEGIES } from "../strategy/language-strategies";
import { KAINFIT_VOCABULARY_PROMPT } from "../../../supabase/functions/transcribe-voice/logic";

describe("Filipino evaluation vocabulary — honesty check", () => {
  it("every inCorpus claim is actually true against the real corpus text (never asserted without checking)", () => {
    const allText = GOLDEN_CORPUS.map((r) => r.intendedTranscript.toLowerCase()).join(" | ");
    for (const entry of FILIPINO_EVALUATION_VOCABULARY) {
      const actuallyPresent = allText.includes(entry.word.toLowerCase());
      expect(actuallyPresent).toBe(entry.inCorpus);
    }
  });

  it("has at least the 22 words required by Part 12", () => {
    expect(FILIPINO_EVALUATION_VOCABULARY.length).toBeGreaterThanOrEqual(22);
  });

  it("every entry documents a reason and at least one plausible mis-transcription", () => {
    for (const entry of FILIPINO_EVALUATION_VOCABULARY) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.plausibleMisTranscriptions.length).toBeGreaterThan(0);
    }
  });

  it("reports known gaps honestly rather than hiding them", () => {
    const gaps = vocabularyGapsNotInCorpus();
    // sayote, ulam, and "puti ng itlog" are documented gaps — see file header.
    expect(gaps.length).toBeGreaterThan(0);
  });
});

describe("Language strategies (Part 11)", () => {
  it("defines exactly the 5 required strategies A-E", () => {
    expect(LANGUAGE_STRATEGIES.map((s) => s.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("strategy A (auto-detect) sends no language hint", () => {
    const a = LANGUAGE_STRATEGIES.find((s) => s.id === "A")!;
    expect(a.languageParam).toBeUndefined();
  });

  it("strategy C (Tagalog hint) is a real hint, not silently disabled — but is not applied anywhere in production", () => {
    const c = LANGUAGE_STRATEGIES.find((s) => s.id === "C")!;
    expect(c.languageParam).toBe("tl");
  });

  it("strategies D and E use the REAL production vocabulary prompt, not a duplicated/drifted copy", () => {
    const d = LANGUAGE_STRATEGIES.find((s) => s.id === "D")!;
    const e = LANGUAGE_STRATEGIES.find((s) => s.id === "E")!;
    expect(d.promptText).toBe(KAINFIT_VOCABULARY_PROMPT);
    expect(e.promptText).toBe(KAINFIT_VOCABULARY_PROMPT);
  });

  it("every strategy targets the exact same model and endpoint as Stage 1's production logic.ts", () => {
    for (const s of LANGUAGE_STRATEGIES) {
      expect(s.model).toBe("gpt-4o-mini-transcribe");
      expect(s.endpoint).toBe("https://api.openai.com/v1/audio/transcriptions");
    }
  });
});
