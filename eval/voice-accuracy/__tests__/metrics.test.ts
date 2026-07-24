import { describe, it, expect } from "vitest";
import {
  wordErrorRate,
  characterErrorRate,
  normalizedWordErrorRate,
  scoreSemanticMeal,
  latencyPercentiles,
  matchFood,
} from "../scoring/metrics";
import { classifyErrors, worstSeverity } from "../scoring/severity";
import { GOLDEN_CORPUS } from "../corpus/golden-corpus";

describe("wordErrorRate / characterErrorRate", () => {
  it("is 0 for an identical transcript", () => {
    expect(wordErrorRate("chicken breast", "chicken breast")).toBe(0);
    expect(characterErrorRate("chicken breast", "chicken breast")).toBe(0);
  });

  it("is 1 (all substitutions) for a completely different single-word transcript", () => {
    expect(wordErrorRate("chicken", "banana")).toBe(1);
  });

  it("counts one substitution correctly in a longer sentence", () => {
    // "two hundred grams chicken breast" vs "...chicken thigh" — 1 sub / 5 words
    expect(
      wordErrorRate("two hundred grams chicken breast", "two hundred grams chicken thigh"),
    ).toBeCloseTo(0.2, 5);
  });
});

describe("normalizedWordErrorRate", () => {
  it("treats spelled-out and compound numbers as equal to their digit form", () => {
    expect(
      normalizedWordErrorRate("two hundred grams chicken breast", "200 g chicken breast"),
    ).toBe(0);
  });

  it("does not treat a critical adversarial pair as equal", () => {
    expect(
      normalizedWordErrorRate("fifteen grams peanut butter", "fifty grams peanut butter"),
    ).toBeGreaterThan(0);
  });
});

describe("scoreSemanticMeal — using real corpus records", () => {
  it("scores a perfect echo of a multi-food utterance as fully correct", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-01")!;
    const score = scoreSemanticMeal(record.expected, record.intendedTranscript);
    expect(score.foodEntityRecall).toBe(1);
    expect(score.quantityAccuracy).toBe(1);
    expect(score.rawCookedAccuracy).toBe(1);
    expect(score.completeSemanticMealAccuracy).toBe(true);
  });

  it("detects a changed quantity when the transcript has the wrong number", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-adv-02a")!; // 200g
    const wrongTranscript = "Three hundred grams of chicken breast."; // the OTHER half of the pair
    const score = scoreSemanticMeal(record.expected, wrongTranscript);
    expect(score.quantityAccuracy).toBe(0);
    expect(score.completeSemanticMealAccuracy).toBe(false);
  });

  it("detects a missing food entirely (recall < 1)", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "tgl-01")!; // 3 foods
    const partialTranscript = "Dalawang itlog."; // only 1 of 3
    const score = scoreSemanticMeal(record.expected, partialTranscript);
    expect(score.foodEntityRecall).toBeLessThan(1);
    expect(score.multiFoodComplete).toBe(false);
  });

  it("does not penalize quantity/unit when none was expected (null, not 0)", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "fil-18")!; // chicken with no stated quantity
    const score = scoreSemanticMeal(record.expected, record.intendedTranscript);
    const chickenMatch = score.foodMatches.find((m) => m.food.food === "chicken");
    expect(chickenMatch?.quantityCorrect).toBeNull();
  });

  it("detects a lost exclusion", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-adv-07b")!; // "no rice"
    const score = scoreSemanticMeal(record.expected, "Chicken breast."); // exclusion dropped
    expect(score.exclusionsPreserved).toBe(false);
  });

  it("detects a lost negation", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "fil-adv-10b")!; // "huwag lagyan ng kanin"
    const score = scoreSemanticMeal(record.expected, "Lagyan ng kanin."); // negation flipped away
    expect(score.negationPreserved).toBe(false);
  });

  it("detects a lost correction", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "fil-14")!;
    const score = scoreSemanticMeal(record.expected, "Dalawang piraso ng tocino."); // only the corrected value present, not the original spoken value
    expect(score.correctionsPreserved).toBe(false);
  });
});

describe("classifyErrors / worstSeverity", () => {
  it("classifies a changed quantity as CRITICAL", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-adv-02a")!;
    const transcript = "Three hundred grams of chicken breast.";
    const score = scoreSemanticMeal(record.expected, transcript);
    const wer = 0; // irrelevant to this check
    const errors = classifyErrors(record.expected, transcript, score, wer);
    expect(worstSeverity(errors)).toBe("critical");
    expect(errors.some((e) => e.category === "changed_quantity")).toBe(true);
  });

  it("classifies tablespoon-vs-teaspoon specifically, not as a generic unit error", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-adv-09a")!; // tbsp
    const transcript = "One teaspoon of olive oil.";
    const score = scoreSemanticMeal(record.expected, transcript);
    const errors = classifyErrors(record.expected, transcript, score, 0);
    expect(errors.some((e) => e.category === "changed_tablespoon_teaspoon")).toBe(true);
  });

  it("classifies raw-vs-cooked as CRITICAL with the specific category", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-adv-04a")!; // raw
    const transcript = "Two hundred grams cooked chicken breast.";
    const score = scoreSemanticMeal(record.expected, transcript);
    const errors = classifyErrors(record.expected, transcript, score, 0);
    expect(
      errors.some((e) => e.category === "changed_raw_cooked_state" && e.severity === "critical"),
    ).toBe(true);
  });

  it("classifies a fabricated food as CRITICAL when it's in the known vocabulary but not expected", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-10")!; // just a banana
    const transcript = "One medium banana and some rice.";
    const score = scoreSemanticMeal(record.expected, transcript);
    const errors = classifyErrors(record.expected, transcript, score, 0, ["banana", "rice"]);
    expect(errors.some((e) => e.category === "added_food_never_spoken")).toBe(true);
  });

  it("classifies a lost preparation method as MAJOR, not CRITICAL", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-06")!; // deep-fried tilapia
    const transcript = "150 grams tilapia."; // prep dropped
    const score = scoreSemanticMeal(record.expected, transcript);
    const errors = classifyErrors(record.expected, transcript, score, 0.1);
    expect(
      errors.some((e) => e.category === "lost_preparation_method" && e.severity === "major"),
    ).toBe(true);
    expect(errors.every((e) => e.severity !== "critical")).toBe(true);
  });

  it("classifies punctuation/filler-only differences as MINOR or no error, never CRITICAL", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "en-01")!;
    const transcript = record.intendedTranscript.toLowerCase().replace(/\./g, "");
    const score = scoreSemanticMeal(record.expected, transcript);
    const wer = 0.02;
    const errors = classifyErrors(record.expected, transcript, score, wer);
    expect(errors.every((e) => e.severity !== "critical")).toBe(true);
  });
});

describe("matchFood", () => {
  it("matches a multi-word spokenAs phrase as a contiguous token sequence", () => {
    const record = GOLDEN_CORPUS.find((r) => r.id === "fil-adv-07a")!;
    const entity = record.expected.foods[0]; // "dibdib ng manok"
    const match = matchFood(entity, ["200", "g", "ng", "dibdib", "ng", "manok"]);
    expect(match.foodDetected).toBe(true);
  });
});

describe("latencyPercentiles", () => {
  it("computes p50/p75/p90/p95 over a known sorted set", () => {
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const result = latencyPercentiles(latencies);
    expect(result.p50).toBe(50);
    expect(result.p95).toBe(95);
  });

  it("returns 0s for an empty array rather than throwing", () => {
    expect(latencyPercentiles([])).toEqual({ p50: 0, p75: 0, p90: 0, p95: 0 });
  });
});
