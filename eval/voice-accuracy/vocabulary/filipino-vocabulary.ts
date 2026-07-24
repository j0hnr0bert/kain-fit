// Stage 3A Filipino evaluation vocabulary (Part 12).
//
// This is an EVALUATION vocabulary — it exists to reason about plausible
// ASR mis-transcriptions and to check corpus coverage. It is NOT used for
// nutrition calculation (see KAINFIT_VOCABULARY_PROMPT in
// supabase/functions/transcribe-voice/logic.ts for the actual production
// prompt, which this file does not modify or replace).
//
// "Provider documentation" below reflects what OpenAI actually publishes
// for the Whisper-family / gpt-4o-transcribe `prompt` parameter: their
// docs describe the prompt as a general mechanism for biasing
// vocabulary and give guidance to "include a few example of the specific
// style or vocabulary you want to bias the model toward" — they do NOT
// publish word-by-word tested accuracy for arbitrary vocabulary,
// Filipino or otherwise. So "documented by provider" here means "the
// general prompting mechanism is documented", never "this specific
// word's recognition improvement is documented" — that claim would be
// false and is not made anywhere in this file.

export interface VocabularyEntry {
  word: string;
  reason: string;
  plausibleMisTranscriptions: string[];
  providerPromptingDocumented: boolean; // the general mechanism, not per-word accuracy — see file header
  inCorpus: boolean; // filled in by scripts/check-vocabulary-coverage; see __tests__/vocabulary.test.ts
}

export const FILIPINO_EVALUATION_VOCABULARY: VocabularyEntry[] = [
  {
    word: "adobo",
    reason:
      "One of the most common Filipino dishes logged; short and could be misheard as an unrelated word.",
    plausibleMisTranscriptions: ["a dobo", "a dough bow", "adobe"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "bangus",
    reason: "Milkfish — the Filipino name is what users actually say, not 'milkfish'.",
    plausibleMisTranscriptions: ["bangus", "bungus", "banggus"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "sinigang",
    reason:
      "Extremely common sour soup dish; multi-syllable word with a similar-sounding near-miss ('sining ang').",
    plausibleMisTranscriptions: ["sining ang", "sinig ang", "cinnamon"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "tinola",
    reason: "Common chicken-ginger soup; risk of collapsing to 'tin cola' or similar.",
    plausibleMisTranscriptions: ["tin cola", "tin nola", "de nola"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "tapa",
    reason:
      "Very short word, high collision risk with unrelated English words ('tapa' vs 'tap a').",
    plausibleMisTranscriptions: ["tap a", "tapper", "tarpa"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "tocino",
    reason: "Common cured-pork breakfast dish; risk of Spanish/Italian-sounding mis-hearing.",
    plausibleMisTranscriptions: ["toucan", "tocina", "tossing o"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "longganisa",
    reason:
      "Common sausage dish, long word with an unusual consonant cluster for an English-tuned model.",
    plausibleMisTranscriptions: ["long ganisa", "longonisa", "long an easa"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "kare-kare",
    reason:
      "Reduplicated word — ASR systems sometimes collapse reduplication to a single instance.",
    plausibleMisTranscriptions: ["kare", "carry carry", "curry curry"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "sisig",
    reason: "Very common pulutan/meal dish; short word, could merge with adjacent words.",
    plausibleMisTranscriptions: ["see sig", "sizzig", "sisik"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "lumpia",
    reason: "Common spring-roll dish; risk of being heard as 'lump ya' or similar.",
    plausibleMisTranscriptions: ["lump ya", "lumpya", "lumpea"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "pancit",
    reason: "Extremely common noodle dish; short word, homophone risk with 'pan sit'.",
    plausibleMisTranscriptions: ["pan sit", "pansit", "pancett"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "nilaga",
    reason:
      "Common boiled-meat dish, also used as a preparation adjective — dual role increases ambiguity.",
    plausibleMisTranscriptions: ["nee laga", "nila ga", "nilagang"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "kalabasa",
    reason: "Squash — common vegetable in Filipino dishes, multi-syllable word.",
    plausibleMisTranscriptions: ["kala basa", "calabasa", "kala vasa"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "kangkong",
    reason:
      "Water spinach — common vegetable, reduplicated-sounding word similar to kare-kare's risk.",
    plausibleMisTranscriptions: ["kang kong", "kong kong", "kangkung"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "sayote",
    reason: "Chayote — common vegetable; risk of being heard as a Spanish/English-sounding word.",
    plausibleMisTranscriptions: ["sail o te", "sayoti", "seiyote"],
    providerPromptingDocumented: true,
    inCorpus: false,
  },
  {
    word: "bagoong",
    reason:
      "Fermented shrimp/fish paste condiment; frequently spoken as an addition, not a base food.",
    plausibleMisTranscriptions: ["ba goong", "bag oong", "bagong"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "lechon kawali",
    reason:
      "Very common crispy pork dish; two-word phrase increases risk of a partial mis-hearing.",
    plausibleMisTranscriptions: ["lechon kwali", "let-chon kawali", "lesson kawali"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "crispy pata",
    reason: "Common crispy pork-leg dish; 'pata' alone is short and collision-prone.",
    plausibleMisTranscriptions: ["crispy patta", "crispy pada", "crispy potter"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "kanin",
    reason: "Cooked rice — one of the single most common words in any Filipino meal log.",
    plausibleMisTranscriptions: ["kanin", "ka nin", "canine"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "ulam",
    reason: "Generic word for a viand/main dish accompanying rice; short, common in casual speech.",
    plausibleMisTranscriptions: ["ulan", "ulum", "you lamb"],
    providerPromptingDocumented: true,
    inCorpus: false,
  },
  {
    word: "itlog",
    reason: "Egg — extremely common, short word with a plosive ending that ASR sometimes drops.",
    plausibleMisTranscriptions: ["it log", "itlog", "it lok"],
    providerPromptingDocumented: true,
    inCorpus: true,
  },
  {
    word: "puti ng itlog",
    reason:
      "Egg white — a critical adversarial-style phrase (egg vs egg white changes protein/fat content materially).",
    plausibleMisTranscriptions: ["puti ng itlog", "puting itlog", "puti nitlog"],
    providerPromptingDocumented: true,
    inCorpus: false,
  },
];

export function vocabularyGapsNotInCorpus(): string[] {
  return FILIPINO_EVALUATION_VOCABULARY.filter((v) => !v.inCorpus).map((v) => v.word);
}
