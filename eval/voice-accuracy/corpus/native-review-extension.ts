// Stage 3C native-review corpus extension.
//
// PROVENANCE: every record below was engineer-drafted (not written or
// checked by a native Filipino/Tagalog speaker) to close three specific,
// verified gaps found in the locked 120-record corpus
// (corpus/golden-corpus.ts) ahead of real native-speaker testing:
//
//   1. Zero coverage of "sautéed"/"ginisa" as a preparation method (the
//      locked corpus has grilled/inihaw, boiled/nilaga, steamed, and
//      fried/pinirito, but nothing sautéed).
//   2. No explicit singular-vs-plural quantity pair.
//   3. The locked corpus only ever sets speakingRate to "fast" or "quiet"
//      — "normal" (a valid FixtureMetadataPlaceholders value) is never
//      used explicitly. Note: the type only supports normal/fast/quiet —
//      there is no "slow" value. If slow-speech coverage distinct from
//      "normal" is wanted, that requires a schema decision, not a
//      corpus-only fix — flagged here rather than silently added.
//
// This file is NEVER merged into GOLDEN_CORPUS and never silently alters
// the locked corpus — it is a separate, explicitly-labeled array. Every
// record sets `needsNativeReview: true`. Do not treat any Filipino/Taglish
// text here as linguistically approved, do not use it to score a release
// gate, and do not remove `needsNativeReview` without an actual native
// speaker confirming the phrase is natural and correct.

import { normalizeTranscript } from "../scoring/normalize";
import type {
  CorpusRecord,
  ExpectedFoodEntity,
  SemanticMealSignature,
  LanguageGroup,
  DifficultyLevel,
  ChallengeCategory,
  TestSplit,
} from "./types";

// Deliberately identical construction pattern to golden-corpus.ts's
// food()/sig()/rec() — redefined locally rather than exporting from the
// locked file, so that file stays completely untouched.
function food(
  f: Partial<ExpectedFoodEntity> & Pick<ExpectedFoodEntity, "food" | "spokenAs">,
): ExpectedFoodEntity {
  return {
    quantity: null,
    unit: null,
    preparation: [],
    stateModifiers: [],
    packedMedium: null,
    brand: null,
    ...f,
  };
}

function sig(
  partial: Partial<SemanticMealSignature> &
    Pick<SemanticMealSignature, "foods" | "utteranceLanguage">,
): SemanticMealSignature {
  return {
    additions: [],
    exclusions: [],
    negations: [],
    corrections: [],
    codeSwitchPoints: [],
    criticalTokens: [],
    ...partial,
  };
}

function rec(input: {
  id: string;
  languageGroup: LanguageGroup;
  intendedTranscript: string;
  expected: SemanticMealSignature;
  difficulty: DifficultyLevel;
  challengeCategories: ChallengeCategory[];
  reviewerNotes: string; // required here, unlike the locked corpus — every extension record must explain its provenance/gap
  speakingRate?: "normal" | "fast" | "quiet" | null;
}): CorpusRecord {
  return {
    id: input.id,
    languageGroup: input.languageGroup,
    intendedTranscript: input.intendedTranscript,
    normalizedReferenceTranscript: normalizeTranscript(input.intendedTranscript),
    expected: input.expected,
    difficulty: input.difficulty,
    challengeCategories: input.challengeCategories,
    testSplit: "development" as TestSplit, // never locked_challenge — unreviewed text must never be treated as a locked gate
    isAdversarial: false,
    adversarialPairId: null,
    reviewerNotes: input.reviewerNotes,
    needsNativeReview: true,
    audioFixtureId: null,
    speakerId: null,
    deviceMetadata: null,
    browserMetadata: null,
    microphoneMetadata: null,
    noiseCondition: null,
    speakingRate: input.speakingRate ?? null,
  };
}

export const NATIVE_REVIEW_EXTENSION: CorpusRecord[] = [
  // --- Gap 1: sautéed / "ginisa" ---
  rec({
    id: "ext-fil-01",
    languageGroup: "filipino",
    intendedTranscript: "Isang tasa ng ginisang gulay.",
    expected: sig({
      foods: [
        food({
          food: "vegetables",
          spokenAs: "ginisang gulay",
          quantity: 1,
          unit: "cup",
          preparation: ["sauteed"],
        }),
      ],
      utteranceLanguage: "filipino",
    }),
    difficulty: "medium",
    challengeCategories: ["preparation_method", "quantity_precision"],
    reviewerNotes:
      "Engineer-drafted to close the zero-coverage gap for sautéed preparation. 'ginisa'/'ginisang' is the common Filipino term for sautéed, but this exact phrasing has not been confirmed natural by a native speaker — needsNativeReview.",
  }),
  rec({
    id: "ext-tgl-01",
    languageGroup: "taglish",
    intendedTranscript: "150 grams ginisang shrimp, konting oil lang.",
    expected: sig({
      foods: [
        food({
          food: "shrimp",
          spokenAs: "ginisang shrimp",
          quantity: 150,
          unit: "g",
          preparation: ["sauteed"],
        }),
      ],
      additions: ["oil"],
      utteranceLanguage: "taglish",
      codeSwitchPoints: [2],
    }),
    difficulty: "medium",
    challengeCategories: ["preparation_method", "code_switching"],
    reviewerNotes:
      "Same sautéed-coverage gap, Taglish form with mid-sentence code-switching. needsNativeReview — not confirmed natural.",
  }),

  // --- Gap 2: explicit singular vs plural quantity pair ---
  rec({
    id: "ext-fil-02",
    languageGroup: "filipino",
    intendedTranscript: "Isang itlog.",
    expected: sig({
      foods: [food({ food: "egg", spokenAs: "itlog", quantity: 1 })],
      utteranceLanguage: "filipino",
    }),
    difficulty: "easy",
    challengeCategories: ["quantity_precision", "filipino_number_words"],
    reviewerNotes:
      "Singular half of an explicit singular/plural pair with ext-fil-03 — the locked corpus has no record pair isolating this contrast. needsNativeReview.",
  }),
  rec({
    id: "ext-fil-03",
    languageGroup: "filipino",
    intendedTranscript: "Tatlong itlog.",
    expected: sig({
      foods: [food({ food: "egg", spokenAs: "itlog", quantity: 3 })],
      utteranceLanguage: "filipino",
    }),
    difficulty: "easy",
    challengeCategories: ["quantity_precision", "filipino_number_words"],
    reviewerNotes:
      "Plural half of the pair with ext-fil-02 — 'itlog' does not inflect for number in Tagalog, so the ASR must get the number word right, not a word ending. needsNativeReview.",
  }),

  // --- Gap 3: explicit speakingRate: "normal" representation ---
  rec({
    id: "ext-tgl-02",
    languageGroup: "taglish",
    intendedTranscript: "One cup rice, dalawang itlog, at isang piraso ng tocino.",
    expected: sig({
      foods: [
        food({ food: "rice", spokenAs: "rice", quantity: 1, unit: "cup" }),
        food({ food: "egg", spokenAs: "itlog", quantity: 2 }),
        food({ food: "tocino", spokenAs: "tocino", quantity: 1, unit: "pc" }),
      ],
      utteranceLanguage: "taglish",
      codeSwitchPoints: [2, 4],
    }),
    difficulty: "medium",
    challengeCategories: ["multi_food", "code_switching", "filipino_english_homophone"],
    speakingRate: "normal",
    reviewerNotes:
      "Explicit normal-pace record — the locked corpus only ever sets speakingRate to fast or quiet, never normal explicitly. Also exercises the tocino homophone risk already tagged in the locked corpus. needsNativeReview.",
  }),
];

// The type's speakingRate enum has no "slow" value distinct from "normal"
// — flagged in the file header. Not fixed here since it's a schema
// decision, not a corpus-content gap.
export const KNOWN_SCHEMA_GAP_NO_SLOW_SPEAKING_RATE = true;
