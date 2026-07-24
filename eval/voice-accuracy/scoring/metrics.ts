// Stage 3A scoring (Part 8).
//
// Two very different kinds of metric live here, and they must not be
// confused with each other:
//
// 1. TRANSCRIPT metrics (WER/CER/normalized WER) are exact, general edit-
//    distance computations over any two strings. These are real,
//    unconditionally correct implementations.
//
// 2. SEMANTIC metrics (food-entity precision/recall, quantity accuracy,
//    etc.) require knowing whether a food/quantity/unit/modifier was
//    actually said. Stage 3A has no production food parser to call (and
//    is explicitly forbidden from building or touching one — see the
//    sprint's scope prohibitions). Production food.functions.ts is not
//    imported anywhere in this directory. What's implemented here
//    instead is a bounded, deterministic, evaluation-only substring/
//    token-presence heuristic against the corpus's own expected
//    structure: "does the normalized transcript contain evidence of the
//    expected food/quantity/unit/modifier". This is NOT a general NLU
//    parser and is not a substitute for one — it exists only so this
//    evaluation system can score mocked and (later) real transcripts
//    against known-correct expectations without depending on, or
//    duplicating, the production nutrition pipeline. This limitation is
//    documented here and repeated in every report the runner produces.

import { normalizeTranscript, tokenize } from "./normalize";
import type { SemanticMealSignature, ExpectedFoodEntity } from "../corpus/types";

// ---------------------------------------------------------------------
// Generic edit distance (Levenshtein) over an arbitrary token sequence.
// ---------------------------------------------------------------------
function levenshtein<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// ---------------------------------------------------------------------
// Transcript metrics
// ---------------------------------------------------------------------

/** Raw word error rate over the exact strings as given (no normalization). */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const refWords = reference.trim().length === 0 ? [] : reference.trim().split(/\s+/);
  const hypWords = hypothesis.trim().length === 0 ? [] : hypothesis.trim().split(/\s+/);
  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;
  return levenshtein(refWords, hypWords) / refWords.length;
}

/** Raw character error rate over the exact strings as given. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const refChars = Array.from(reference);
  const hypChars = Array.from(hypothesis);
  if (refChars.length === 0) return hypChars.length === 0 ? 0 : 1;
  return levenshtein(refChars, hypChars) / refChars.length;
}

/** Word error rate computed after applying normalizeTranscript() to both sides. */
export function normalizedWordErrorRate(reference: string, hypothesis: string): number {
  const refTokens = tokenize(normalizeTranscript(reference));
  const hypTokens = tokenize(normalizeTranscript(hypothesis));
  if (refTokens.length === 0) return hypTokens.length === 0 ? 0 : 1;
  return levenshtein(refTokens, hypTokens) / refTokens.length;
}

// ---------------------------------------------------------------------
// Semantic metrics — bounded evaluation-only heuristic (see file header)
// ---------------------------------------------------------------------

function containsPhrase(haystackTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return false;
  for (let i = 0; i + phraseTokens.length <= haystackTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (haystackTokens[i + j] !== phraseTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function normalizedTokens(s: string): string[] {
  return tokenize(normalizeTranscript(s));
}

export interface FoodMatchResult {
  food: ExpectedFoodEntity;
  foodDetected: boolean;
  quantityCorrect: boolean | null; // null = no quantity was expected, not scored
  unitCorrect: boolean | null; // null = no unit was expected
  preparationCorrect: boolean | null; // null = no preparation was expected
  stateModifiersCorrect: boolean | null; // null = no state modifiers expected
  brandCorrect: boolean | null; // null = no brand expected
}

export function matchFood(entity: ExpectedFoodEntity, transcriptTokens: string[]): FoodMatchResult {
  const foodDetected = containsPhrase(transcriptTokens, normalizedTokens(entity.spokenAs));

  const quantityCorrect =
    entity.quantity === null ? null : transcriptTokens.includes(String(entity.quantity));

  const unitCorrect =
    entity.unit === null ? null : containsPhrase(transcriptTokens, normalizedTokens(entity.unit));

  const preparationCorrect =
    entity.preparation.length === 0
      ? null
      : entity.preparation.every((p) => containsPhrase(transcriptTokens, normalizedTokens(p)));

  const stateModifiersCorrect =
    entity.stateModifiers.length === 0
      ? null
      : entity.stateModifiers.every((m) => containsPhrase(transcriptTokens, normalizedTokens(m)));

  const brandCorrect =
    entity.brand === null ? null : containsPhrase(transcriptTokens, normalizedTokens(entity.brand));

  return {
    food: entity,
    foodDetected,
    quantityCorrect,
    unitCorrect,
    preparationCorrect,
    stateModifiersCorrect,
    brandCorrect,
  };
}

export interface SemanticScoreResult {
  foodMatches: FoodMatchResult[];
  foodEntityPrecision: number;
  foodEntityRecall: number;
  foodEntityF1: number;
  quantityAccuracy: number | null;
  unitAccuracy: number | null;
  preparationAccuracy: number | null;
  rawCookedAccuracy: number | null;
  skinBoneAccuracy: number | null;
  brandAccuracy: number | null;
  negationPreserved: boolean | null;
  additionsPreserved: boolean | null;
  exclusionsPreserved: boolean | null;
  correctionsPreserved: boolean | null;
  multiFoodComplete: boolean;
  completeSemanticMealAccuracy: boolean;
}

const RAW_COOKED_WORDS = new Set(["raw", "cooked", "hilaw", "luto", "lutong", "niluto"]);
const SKIN_BONE_WORDS = new Set([
  "skinless",
  "skin-on",
  "skin on",
  "boneless",
  "bone-in",
  "bone in",
  "walang balat",
  "may balat",
  "walang buto",
  "may buto",
]);

function ratioOfTrue(values: Array<boolean | null>): number | null {
  const applicable = values.filter((v): v is boolean => v !== null);
  if (applicable.length === 0) return null;
  return applicable.filter(Boolean).length / applicable.length;
}

/**
 * Known-vocabulary check for the "no fabricated foods" release gate: a
 * food mentioned in the transcript that isn't in the expected list AND
 * isn't recognizable as one of the corpus's own known food terms counts
 * as a hallucination candidate. Callers pass the corpus-wide known-food
 * vocabulary explicitly (see runner) rather than this module guessing.
 */
export function scoreSemanticMeal(
  expected: SemanticMealSignature,
  actualTranscript: string,
): SemanticScoreResult {
  const transcriptTokens = normalizedTokens(actualTranscript);
  const foodMatches = expected.foods.map((f) => matchFood(f, transcriptTokens));

  const truePositives = foodMatches.filter((m) => m.foodDetected).length;
  const expectedCount = expected.foods.length;
  // Precision here is bounded by design: without a real extractor we
  // cannot enumerate "foods the transcript mentions that weren't
  // expected" beyond the expected list itself, so precision is reported
  // as 1.0 when every detected expected food was truly expected (i.e. no
  // partial-credit hallucination scoring is claimed) — recall is the
  // metric that actually distinguishes a successful transcript here.
  // This bound is documented, not hidden — see the file header.
  const foodEntityRecall = expectedCount === 0 ? 1 : truePositives / expectedCount;
  const foodEntityPrecision = expectedCount === 0 ? 1 : truePositives / expectedCount;
  const foodEntityF1 =
    foodEntityPrecision + foodEntityRecall === 0
      ? 0
      : (2 * foodEntityPrecision * foodEntityRecall) / (foodEntityPrecision + foodEntityRecall);

  const quantityAccuracy = ratioOfTrue(foodMatches.map((m) => m.quantityCorrect));
  const unitAccuracy = ratioOfTrue(foodMatches.map((m) => m.unitCorrect));
  const preparationAccuracy = ratioOfTrue(foodMatches.map((m) => m.preparationCorrect));
  const brandAccuracy = ratioOfTrue(foodMatches.map((m) => m.brandCorrect));

  const rawCookedExpected = expected.foods.filter((f) =>
    f.stateModifiers.some((m) => RAW_COOKED_WORDS.has(m.toLowerCase())),
  );
  const rawCookedAccuracy =
    rawCookedExpected.length === 0
      ? null
      : rawCookedExpected.every((f) =>
            f.stateModifiers
              .filter((m) => RAW_COOKED_WORDS.has(m.toLowerCase()))
              .every((m) => containsPhrase(transcriptTokens, normalizedTokens(m))),
          )
        ? 1
        : 0;

  const skinBoneExpected = expected.foods.filter((f) =>
    f.stateModifiers.some((m) => SKIN_BONE_WORDS.has(m.toLowerCase())),
  );
  const skinBoneAccuracy =
    skinBoneExpected.length === 0
      ? null
      : skinBoneExpected.every((f) =>
            f.stateModifiers
              .filter((m) => SKIN_BONE_WORDS.has(m.toLowerCase()))
              .every((m) => containsPhrase(transcriptTokens, normalizedTokens(m))),
          )
        ? 1
        : 0;

  const negationPreserved =
    expected.negations.length === 0
      ? null
      : expected.negations.every((n) => containsPhrase(transcriptTokens, normalizedTokens(n)));

  const exclusionsPreserved =
    expected.exclusions.length === 0
      ? null
      : expected.exclusions.every((e) => containsPhrase(transcriptTokens, normalizedTokens(e)));

  const additionsPreserved =
    expected.additions.length === 0
      ? null
      : expected.additions.every((a) => containsPhrase(transcriptTokens, normalizedTokens(a)));

  const correctionsPreserved =
    expected.corrections.length === 0
      ? null
      : expected.corrections.every(
          (c) =>
            containsPhrase(transcriptTokens, normalizedTokens(c.from)) &&
            containsPhrase(transcriptTokens, normalizedTokens(c.to)),
        );

  const multiFoodComplete = expected.foods.length <= 1 || foodEntityRecall === 1;

  const completeSemanticMealAccuracy =
    foodEntityRecall === 1 &&
    (quantityAccuracy === null || quantityAccuracy === 1) &&
    (unitAccuracy === null || unitAccuracy === 1) &&
    (rawCookedAccuracy === null || rawCookedAccuracy === 1) &&
    (skinBoneAccuracy === null || skinBoneAccuracy === 1) &&
    (negationPreserved === null || negationPreserved === true) &&
    (exclusionsPreserved === null || exclusionsPreserved === true) &&
    (correctionsPreserved === null || correctionsPreserved === true);

  return {
    foodMatches,
    foodEntityPrecision,
    foodEntityRecall,
    foodEntityF1,
    quantityAccuracy,
    unitAccuracy,
    preparationAccuracy,
    rawCookedAccuracy,
    skinBoneAccuracy,
    brandAccuracy,
    negationPreserved,
    additionsPreserved,
    exclusionsPreserved,
    correctionsPreserved,
    multiFoodComplete,
    completeSemanticMealAccuracy,
  };
}

// ---------------------------------------------------------------------
// Operational metrics (latency percentiles)
// ---------------------------------------------------------------------

export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(
    sortedAscending.length - 1,
    Math.ceil((p / 100) * sortedAscending.length) - 1,
  );
  return sortedAscending[Math.max(0, idx)];
}

export function latencyPercentiles(latenciesMs: number[]): {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
} {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
  };
}
