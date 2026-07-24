// Stage 3A normalization rules (Part 7).
//
// Normalization is deliberately narrow and deterministic. It exists only
// to remove surface variation that does not change meaning — never to
// erase a difference that would change nutrition. Every rule here is
// documented and independently tested (see __tests__/normalize.test.ts).
//
// Safe to normalize away: capitalization, punctuation, repeated
// whitespace, and a BOUNDED set of number-word <-> digit equivalences for
// the specific English and Filipino number phrases this corpus actually
// uses (see COMPOUND_NUMBER_PHRASES / *_NUMBER_WORDS below). This is
// deliberately NOT a general-purpose number-word parser for arbitrary
// English or Tagalog compound numbers — a naive word-by-word replace
// would turn "two hundred" into "2 100" instead of "200", which is
// exactly the kind of silent corruption this evaluation system exists to
// catch, not commit. The bounded phrase list below is a documented
// limitation, not a hidden one: any compound number phrase used in the
// corpus that isn't in this list will normalize incorrectly, and the
// corpus/normalize test suite is expected to catch that by construction
// (every compound phrase actually used in golden-corpus.ts has a
// corresponding entry here — see normalize.test.ts's corpus-coverage
// check).
//
// Never normalized away: the numeric value itself, unit identity, food
// identity, raw/cooked state, preparation method, negation, correction,
// brand/variant, skin/bone state, packed-in-oil vs packed-in-water, or
// singular/plural where it changes quantity meaning.

// Multi-word compound number phrases, matched BEFORE single-word number
// replacement so "two hundred" resolves to "200", not "2 100". Ordered
// longest-phrase-first isn't required since these are non-overlapping
// literal phrases, but kept grouped by language for readability.
const COMPOUND_NUMBER_PHRASES: Array<[RegExp, string]> = [
  // English
  [/\btwo hundred\b/g, "200"],
  [/\bthree hundred\b/g, "300"],
  [/\bone hundred fifty\b/g, "150"],
  [/\bone hundred\b/g, "100"],
  [/\bone and a half\b/g, "1.5"],
  // Filipino — "daan"/"raan" = hundred; "at" = "and" connector
  [/\bdalawang da+ng\b/g, "200"],
  [/\bdalawang da+n\b/g, "200"],
  [/\btatlong da+ng\b/g, "300"],
  [/\btatlong da+n\b/g, "300"],
  [/\bisang da+n at limampu+ng\b/g, "150"],
  [/\bisang da+n at limampu+\b/g, "150"],
  [/\bisang da+ng\b/g, "100"],
  [/\bisang da+n\b/g, "100"],
  [/\bisa'?t kalahati(ng)?\b/g, "1.5"],
];

const ENGLISH_NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
  half: "0.5",
};

// Bounded to the standalone (non-compound) Filipino number words actually
// used in this corpus — documented limitation, not a general Tagalog
// numeral parser. Compound phrases are handled above.
const FILIPINO_NUMBER_WORDS: Record<string, string> = {
  isa: "1",
  isang: "1",
  dalawa: "2",
  dalawang: "2",
  tatlo: "3",
  tatlong: "3",
  apat: "4",
  lima: "5",
  limang: "5",
  anim: "6",
  pito: "7",
  pitong: "7",
  walo: "8",
  walong: "8",
  siyam: "9",
  sampu: "10",
  sampung: "10",
  labinlima: "15",
  labinlimang: "15",
  dalawampu: "20",
  dalawampung: "20",
  tatlumpu: "30",
  tatlumpung: "30",
  limampu: "50",
  limampung: "50",
  kalahati: "0.5",
  kalahating: "0.5",
};

// Accepted unit abbreviations, applied only when the underlying unit is
// identical (e.g. "g" and "gram(s)" are the same unit; "tbsp" and
// "tablespoon" are the same unit). tbsp/tsp are DIFFERENT units and are
// never mapped to each other — that distinction is exactly what
// normalization must never erase (Part 7 / the tablespoon-vs-teaspoon
// adversarial pair).
const UNIT_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bgrams?\b/g, "g"],
  [/\bgramo\b/g, "g"],
  [/\bkilograms?\b/g, "kg"],
  [/\bkilos?\b/g, "kg"],
  [/\bmilliliters?\b/g, "ml"],
  [/\bmillilitres?\b/g, "ml"],
  [/\btablespoons?\b/g, "tbsp"],
  [/\bteaspoons?\b/g, "tsp"],
  [/\bkutsara(ng)?\b/g, "tbsp"],
  [/\bkutsarita(ng)?\b/g, "tsp"],
  [/\bpieces?\b/g, "pc"],
  [/\bpiraso\b/g, "pc"],
  [/\bslices?\b/g, "slice"],
  [/\bscoops?\b/g, "scoop"],
  [/\bcans?\b/g, "can"],
  [/\blata\b/g, "can"],
  [/\bpacks?\b/g, "pack"],
  [/\bservings?\b/g, "serving"],
  // Informal serving-style units genuinely used in Filipino/Taglish meal
  // logging ("isang mangkok ng tinola", "isang order ng tapa") —
  // recognized as the same unit as "serving", not a different one.
  [/\border\b/g, "serving"],
  [/\bbowl\b/g, "serving"],
  [/\bplate\b/g, "serving"],
  [/\bmangkok\b/g, "serving"],
  [/\bcups?\b/g, "cup"],
  [/\btasa\b/g, "cup"],
];

function replaceWholeWordNumbers(text: string, table: Record<string, string>): string {
  return text
    .split(" ")
    .map((w) => (Object.prototype.hasOwnProperty.call(table, w) ? table[w] : w))
    .join(" ");
}

export function normalizeTranscript(raw: string): string {
  let text = raw.trim().toLowerCase();
  text = text.replace(/[.,!?;:"“”‘’]/g, "");
  // Hyphen -> space: "skin-on"/"skin on", "air-fried"/"air fried",
  // "deep-fried"/"deep fried", "bone-in"/"bone in" are the same modifier
  // either way it's written/spoken; without this, a ground-truth modifier
  // written with a hyphen would never token-match a transcript that
  // renders it with a space (or vice versa), which is exactly the kind of
  // false "changed modifier" this evaluation system must not produce.
  text = text.replace(/-/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of COMPOUND_NUMBER_PHRASES) {
    text = text.replace(pattern, replacement);
  }
  text = replaceWholeWordNumbers(text, ENGLISH_NUMBER_WORDS);
  text = replaceWholeWordNumbers(text, FILIPINO_NUMBER_WORDS);
  // Spoken decimal: "<digit> point <digit>" -> "<digit>.<digit>", applied
  // AFTER word->digit conversion so "two point five" (already "2 point 5"
  // by this point) becomes "2.5". Bounded to a single trailing digit
  // (this corpus never uses more than one decimal place).
  text = text.replace(/\b(\d+) point (\d)\b/g, "$1.$2");
  for (const [pattern, replacement] of UNIT_ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export function tokenize(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}
