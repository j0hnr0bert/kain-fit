// Stage 3A error severity classification (Part 9).
//
// Built on top of scoreSemanticMeal()'s bounded evaluation heuristic
// (see metrics.ts's file header for what that can and cannot detect).
// "Added a food never spoken" detection is explicitly best-effort: it can
// only recognize hallucinated foods drawn from a known vocabulary list
// the caller supplies (the corpus's own food set plus the Filipino
// evaluation vocabulary) — a fabricated food outside that vocabulary
// would not be caught. This bound is documented, not hidden.

import type { SemanticMealSignature } from "../corpus/types";
import type { SemanticScoreResult } from "./metrics";
import { normalizeTranscript, tokenize } from "./normalize";

export type ErrorSeverity = "critical" | "major" | "minor";

export type ErrorCategory =
  | "changed_quantity"
  | "changed_unit"
  | "changed_food"
  | "lost_negation"
  | "lost_correction"
  | "lost_exclusion"
  | "changed_raw_cooked_state"
  | "changed_tablespoon_teaspoon"
  | "changed_skin_bone_state"
  | "added_food_never_spoken"
  | "removed_spoken_food"
  | "lost_preparation_method"
  | "lost_brand_or_variant"
  | "lost_addition"
  | "incomplete_multi_food"
  | "substantial_omission"
  | "punctuation_or_capitalization"
  | "harmless_filler_or_spelling";

export interface DetectedError {
  severity: ErrorSeverity;
  category: ErrorCategory;
  field: string;
  detail: string;
}

const MAJOR_OMISSION_WER_THRESHOLD = 0.3;
const MINOR_WER_CEILING = 0.1;

export function classifyErrors(
  expected: SemanticMealSignature,
  actualTranscript: string,
  score: SemanticScoreResult,
  normalizedWer: number,
  knownFoodVocabulary: string[] = [],
): DetectedError[] {
  const errors: DetectedError[] = [];

  for (const match of score.foodMatches) {
    if (!match.foodDetected) {
      errors.push({
        severity: "critical",
        category: "removed_spoken_food",
        field: `foods.${match.food.food}`,
        detail: `Expected food "${match.food.food}" (spoken as "${match.food.spokenAs}") was not found in the transcript.`,
      });
      continue; // downstream field checks are meaningless if the food itself is missing
    }
    if (match.quantityCorrect === false) {
      errors.push({
        severity: "critical",
        category: "changed_quantity",
        field: `foods.${match.food.food}.quantity`,
        detail: `Expected quantity ${match.food.quantity} for "${match.food.food}" was not found.`,
      });
    }
    if (match.unitCorrect === false) {
      const isTbspTsp =
        match.food.unit === "tbsp" ||
        match.food.unit === "tsp" ||
        match.food.unit === "kutsara" ||
        match.food.unit === "kutsarita";
      errors.push({
        severity: "critical",
        category: isTbspTsp ? "changed_tablespoon_teaspoon" : "changed_unit",
        field: `foods.${match.food.food}.unit`,
        detail: `Expected unit "${match.food.unit}" for "${match.food.food}" was not found.`,
      });
    }
    if (match.stateModifiersCorrect === false) {
      const isRawCooked = match.food.stateModifiers.some((m) =>
        ["raw", "cooked", "hilaw", "luto", "lutong", "niluto"].includes(m.toLowerCase()),
      );
      errors.push({
        severity: "critical",
        category: isRawCooked ? "changed_raw_cooked_state" : "changed_skin_bone_state",
        field: `foods.${match.food.food}.stateModifiers`,
        detail: `Expected state modifier(s) [${match.food.stateModifiers.join(", ")}] for "${match.food.food}" not fully found.`,
      });
    }
    if (match.preparationCorrect === false) {
      errors.push({
        severity: "major",
        category: "lost_preparation_method",
        field: `foods.${match.food.food}.preparation`,
        detail: `Expected preparation [${match.food.preparation.join(", ")}] for "${match.food.food}" not fully found.`,
      });
    }
    if (match.brandCorrect === false) {
      errors.push({
        severity: "major",
        category: "lost_brand_or_variant",
        field: `foods.${match.food.food}.brand`,
        detail: `Expected brand "${match.food.brand}" for "${match.food.food}" not found.`,
      });
    }
  }

  if (score.negationPreserved === false) {
    errors.push({
      severity: "critical",
      category: "lost_negation",
      field: "negations",
      detail: `Expected negation(s) [${expected.negations.join(", ")}] not fully found in transcript.`,
    });
  }
  if (score.exclusionsPreserved === false) {
    errors.push({
      severity: "critical",
      category: "lost_exclusion",
      field: "exclusions",
      detail: `Expected exclusion(s) [${expected.exclusions.join(", ")}] not fully found in transcript.`,
    });
  }
  if (score.additionsPreserved === false) {
    errors.push({
      severity: "major",
      category: "lost_addition",
      field: "additions",
      detail: `Expected addition(s) [${expected.additions.join(", ")}] not fully found in transcript.`,
    });
  }
  if (score.correctionsPreserved === false) {
    errors.push({
      severity: "critical",
      category: "lost_correction",
      field: "corrections",
      detail: `Expected spoken correction(s) not fully preserved.`,
    });
  }
  if (!score.multiFoodComplete) {
    errors.push({
      severity: "major",
      category: "incomplete_multi_food",
      field: "foods",
      detail: `Not all ${expected.foods.length} expected foods were found in a multi-food utterance.`,
    });
  }

  // Best-effort hallucination detection, bounded to the supplied
  // vocabulary — see file header.
  if (knownFoodVocabulary.length > 0) {
    const transcriptTokens = tokenize(normalizeTranscript(actualTranscript));
    // A vocabulary word legitimately spoken as part of an exclusion
    // ("no rice"), negation ("huwag lagyan ng kanin"), or addition ("may
    // gatas") is not a hallucinated food — it's exactly what the speaker
    // said, just not a base food entity. Only flag a vocabulary word that
    // isn't accounted for by ANY expected field.
    const expectedWords = new Set([
      ...expected.foods.flatMap((f) => tokenize(normalizeTranscript(f.spokenAs))),
      ...expected.foods.flatMap((f) =>
        f.preparation.flatMap((p) => tokenize(normalizeTranscript(p))),
      ),
      ...expected.foods.flatMap((f) =>
        f.stateModifiers.flatMap((m) => tokenize(normalizeTranscript(m))),
      ),
      ...expected.foods.flatMap((f) => (f.brand ? tokenize(normalizeTranscript(f.brand)) : [])),
      ...expected.exclusions.flatMap((e) => tokenize(normalizeTranscript(e))),
      ...expected.negations.flatMap((n) => tokenize(normalizeTranscript(n))),
      ...expected.additions.flatMap((a) => tokenize(normalizeTranscript(a))),
    ]);
    for (const vocabWord of knownFoodVocabulary) {
      const vocabTokens = tokenize(normalizeTranscript(vocabWord));
      if (vocabTokens.length === 0) continue;
      const present = vocabTokens.every((t) => transcriptTokens.includes(t));
      const expectedToContain = vocabTokens.every((t) => expectedWords.has(t));
      if (present && !expectedToContain) {
        errors.push({
          severity: "critical",
          category: "added_food_never_spoken",
          field: "foods",
          detail: `Transcript appears to mention "${vocabWord}", which was not in the expected foods for this utterance.`,
        });
      }
    }
  }

  const hasCriticalOrMajor = errors.length > 0;
  if (!hasCriticalOrMajor) {
    if (normalizedWer > MAJOR_OMISSION_WER_THRESHOLD) {
      errors.push({
        severity: "major",
        category: "substantial_omission",
        field: "transcript",
        detail: `Normalized WER ${normalizedWer.toFixed(2)} exceeds the omission threshold despite no detected semantic-field error.`,
      });
    } else if (normalizedWer > 0 && normalizedWer <= MINOR_WER_CEILING) {
      errors.push({
        severity: "minor",
        category: "harmless_filler_or_spelling",
        field: "transcript",
        detail: `Small normalized WER (${normalizedWer.toFixed(3)}) with no semantic-field error detected — likely filler/spelling variation.`,
      });
    }
  }

  return errors;
}

export function worstSeverity(errors: DetectedError[]): ErrorSeverity | "none" {
  if (errors.some((e) => e.severity === "critical")) return "critical";
  if (errors.some((e) => e.severity === "major")) return "major";
  if (errors.some((e) => e.severity === "minor")) return "minor";
  return "none";
}
