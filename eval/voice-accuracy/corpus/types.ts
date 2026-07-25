// Stage 3A — golden-corpus and ground-truth types.
//
// This directory (eval/voice-accuracy/) is deliberately OUTSIDE both
// src/ (app code) and supabase/functions/ (the deployed transcription
// Edge Function). It is offline evaluation tooling — it never runs in
// production, is never imported by the app or the Edge Function, and
// contains no audio, no real user data, and no secrets.
//
// Ground-truth honesty rule (Part 6): every array below defaults to
// empty, not fabricated. If a speaker never stated a quantity, unit,
// preparation, brand, exclusion, negation, or correction, the
// corresponding field is an empty array / null — never invented. A
// corpus record should never claim more structure than the speaker
// actually spoke.

export type LanguageGroup = "english" | "filipino" | "taglish";

export type TestSplit = "development" | "validation" | "locked_challenge";

export type DifficultyLevel = "easy" | "medium" | "hard" | "adversarial";

export type ChallengeCategory =
  | "quantity_precision"
  | "unit_precision"
  | "raw_cooked_state"
  | "skin_bone_modifier"
  | "brand_variant"
  | "packed_medium"
  | "preparation_method"
  | "negation"
  | "exclusion"
  | "spoken_correction"
  | "multi_food"
  | "code_switching"
  | "filler_disfluency"
  | "false_start"
  | "filipino_number_words"
  | "abbreviated_unit"
  // A Filipino food word that risks being misheard as an unrelated,
  // standalone English word or phrase (not merely a spelling variant, and
  // not reduplication-collapse or word-boundary-merging risk — those are
  // separate, already-covered categories). Applied only where either the
  // word's own vocabulary/filipino-vocabulary.ts entry explicitly frames
  // the risk as a homophone/English-word collision, or its documented
  // plausibleMisTranscriptions list lands on an unambiguous standalone
  // English word. See STAGE_3C_LANGUAGE_DEVICE_EVALUATION_PLAN.md Section 4
  // for the per-record rationale.
  | "filipino_english_homophone"
  | "mixed_dish_no_ingredient_inference"
  | "fast_speech"
  | "quiet_speech"
  | "trailing_exclusion";

// A food/quantity/unit/modifier tuple as actually spoken. Quantity and
// unit are nullable because a speaker can name a food with no stated
// amount ("may itlog ako, saka kanin") — that must be recorded as
// "no quantity spoken", never defaulted to 1 or guessed.
export interface ExpectedFoodEntity {
  food: string; // canonical food name used for scoring, e.g. "chicken breast"
  spokenAs: string; // the actual word(s) used in the transcript for this food
  quantity: number | null;
  unit: string | null; // canonical unit, e.g. "g", "cup", "piece", "scoop"
  preparation: string[]; // e.g. ["grilled"], ["raw"], [] if unstated
  stateModifiers: string[]; // raw/cooked, skinless/skin-on, boneless/bone-in, lean/very lean — only if spoken
  packedMedium: string | null; // "water" | "oil" | null
  brand: string | null;
}

export interface SpokenCorrection {
  from: string; // what was said first
  to: string; // what it was corrected to
  field: "quantity" | "unit" | "food" | "preparation";
}

export interface SemanticMealSignature {
  foods: ExpectedFoodEntity[];
  additions: string[]; // explicitly added extras, e.g. "may gatas" (with milk) — distinct from a base food entity and from exclusions
  exclusions: string[]; // explicitly excluded items, e.g. "no rice"
  negations: string[]; // explicit negations not necessarily about exclusion, e.g. "not a tablespoon, a teaspoon"
  corrections: SpokenCorrection[];
  utteranceLanguage: LanguageGroup;
  codeSwitchPoints: number[]; // word-index positions where the language switches, [] for non-Taglish
  criticalTokens: string[]; // exact tokens where an ASR error would be dangerous (numbers, units, negation words, raw/cooked words)
}

// Metadata placeholders (Part 2) — Stage 3A has no real speakers/devices
// yet, so these are always null, explicitly, never fabricated. Stage 3B
// (real-audio collection, see PROTOCOL.md) is what populates them.
export interface FixtureMetadataPlaceholders {
  audioFixtureId: string | null; // set once an approved real/synthetic audio file exists for this record
  speakerId: string | null; // anonymized, Stage 3B only
  deviceMetadata: string | null; // e.g. "iPhone 14, iOS 18" — Stage 3B only
  browserMetadata: string | null; // e.g. "Safari 18 (installed PWA)" — Stage 3B only
  microphoneMetadata: string | null; // e.g. "built-in" | "AirPods" — Stage 3B only
  noiseCondition: "quiet" | "normal_room" | "gym" | "fan_ac" | null;
  speakingRate: "normal" | "fast" | "quiet" | null;
}

export interface CorpusRecord extends FixtureMetadataPlaceholders {
  id: string; // stable, unique, e.g. "en-001", "fil-014", "tgl-030", "adv-007"
  languageGroup: LanguageGroup;
  intendedTranscript: string; // exactly what the speaker is meant to say
  normalizedReferenceTranscript: string; // after applying normalize.ts's rules
  expected: SemanticMealSignature;
  difficulty: DifficultyLevel;
  challengeCategories: ChallengeCategory[];
  testSplit: TestSplit;
  isAdversarial: boolean;
  adversarialPairId: string | null; // links two records that differ by one critical token
  reviewerNotes: string;
}

export interface AdversarialPair {
  pairId: string;
  contrastDescription: string; // e.g. "15g vs 50g"
  recordIdA: string;
  recordIdB: string;
  criticalField: "quantity" | "unit" | "food" | "state" | "packedMedium" | "negation";
}
