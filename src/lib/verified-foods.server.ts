// Server-only verified-foods lookup. Attempts to resolve a single-food
// natural-language input directly from public.verified_foods, skipping the
// AI call. Conservative on purpose — only fires when the whole input maps
// cleanly to one seeded food, and bails on multi-item inputs or ambiguous
// raw/cooked cases so the AI + clarification path stays in charge there.

type VerifiedRow = {
  canonical_name: string;
  name: string;
  aliases: string[];
  category: string;
  default_serving_grams: number | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  preparation_state: "raw" | "cooked" | "n_a";
};

type ResolvedItem = {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation: string | null;
  meal_type: "breakfast" | "lunch" | "dinner" | "snacks";
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  confidence: number;
  is_estimate: boolean;
  clarification_needed: boolean;
  clarification_question: string | null;
};

const CACHE_TTL_MS = 60_000;
let rowCache: { at: number; rows: VerifiedRow[] } | null = null;

async function loadRows(): Promise<VerifiedRow[]> {
  const now = Date.now();
  if (rowCache && now - rowCache.at < CACHE_TTL_MS) return rowCache.rows;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: boolean) => Promise<{ data: VerifiedRow[] | null; error: unknown }>;
      };
    };
  };
  const res = await admin
    .from("verified_foods")
    .select(
      "canonical_name,name,aliases,category,default_serving_grams,kcal_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,preparation_state",
    )
    .eq("is_active", true);
  const rows = (res.data ?? []) as VerifiedRow[];
  rowCache = { at: now, rows };
  return rows;
}

export function invalidateVerifiedFoodsCache(): void {
  rowCache = null;
}

const CONJUNCTION_RE = /(?:\band\b|\bwith\b|\bplus\b|,|;|\+|&|\bat\b)/i;

const PREP_KEYWORDS = [
  "raw",
  "uncooked",
  "dry",
  "cooked",
  "boiled",
  "steamed",
  "grilled",
  "fried",
  "baked",
  "roasted",
];

// grams-per-serving fallbacks when default_serving_grams is null.
const UNIT_TO_GRAMS: Record<string, number | "use_default"> = {
  g: 1,
  gram: 1,
  grams: 1,
  gr: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.6,
  cup: "use_default",
  cups: "use_default",
  serving: "use_default",
  servings: "use_default",
  bowl: "use_default",
  bowls: "use_default",
  piece: "use_default",
  pieces: "use_default",
  pc: "use_default",
  pcs: "use_default",
  slice: "use_default",
  slices: "use_default",
  can: "use_default",
  cans: "use_default",
  pack: "use_default",
  packs: "use_default",
};

const AMBIGUOUS_PREP_CATEGORIES = new Set(["grain", "meat", "fish"]);

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

type ParsedInput = {
  quantity: number;
  unit: string | null;
  rest: string;
  hadWeight: boolean;
  hadPrepKeyword: boolean;
};

function parseInput(raw: string): ParsedInput | null {
  const s = normalize(raw);
  if (!s) return null;
  if (CONJUNCTION_RE.test(s)) return null;

  const hadPrepKeyword = PREP_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(s));

  // Try "<num> <unit> <rest>" or "<num> <rest>"
  const m = s.match(
    /^(\d+(?:\.\d+)?)\s*(g|gram|grams|gr|kg|oz|lb|cups?|servings?|bowls?|pieces?|pcs?|pc|slices?|cans?|packs?)?\s+(.+)$/,
  );
  if (m) {
    const qty = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    const rest = m[3].trim();
    const isWeight = ["g", "gr", "gram", "grams", "kg", "oz", "lb"].includes(unit);
    return { quantity: qty, unit: unit || null, rest, hadWeight: isWeight, hadPrepKeyword };
  }
  // No quantity — implicit 1 serving.
  return { quantity: 1, unit: null, rest: s, hadWeight: false, hadPrepKeyword };
}

function matchRow(rest: string, rows: VerifiedRow[]): VerifiedRow | null {
  const target = normalize(rest);
  // Strip trailing preparation adjectives that aren't part of any alias
  const stripped = target
    .replace(/\b(raw|uncooked|dry|cooked|boiled|steamed|grilled|fried|baked|roasted)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [target, stripped].filter(Boolean);

  for (const cand of candidates) {
    for (const row of rows) {
      if (normalize(row.canonical_name) === cand) return row;
      if (normalize(row.name) === cand) return row;
      for (const a of row.aliases) {
        if (normalize(a) === cand) return row;
      }
    }
  }
  return null;
}

// Prefer a row whose preparation state matches an explicit keyword in input.
function refineByPreparation(row: VerifiedRow, rest: string, rows: VerifiedRow[]): VerifiedRow {
  const t = normalize(rest);
  const wantsRaw = /\b(raw|uncooked|dry)\b/.test(t);
  const wantsCooked = /\b(cooked|boiled|steamed|grilled|fried|baked|roasted)\b/.test(t);
  if (!wantsRaw && !wantsCooked) return row;
  if (wantsRaw && row.preparation_state === "raw") return row;
  if (wantsCooked && row.preparation_state === "cooked") return row;
  // Search for a sibling row with the desired preparation.
  const base = normalize(row.name)
    .replace(/\(.*?\)/g, "")
    .trim();
  const wantState: "raw" | "cooked" = wantsRaw ? "raw" : "cooked";
  const alt = rows.find(
    (r) =>
      r.preparation_state === wantState &&
      (normalize(r.name).startsWith(base) || r.aliases.some((a) => normalize(a).startsWith(base))),
  );
  return alt ?? row;
}

function computeGrams(parsed: ParsedInput, row: VerifiedRow): number | null {
  const unit = parsed.unit;
  if (!unit) {
    // implicit servings
    return parsed.quantity * (row.default_serving_grams ?? 100);
  }
  const mapping = UNIT_TO_GRAMS[unit];
  if (mapping === undefined) return null;
  if (mapping === "use_default") {
    return parsed.quantity * (row.default_serving_grams ?? 100);
  }
  return parsed.quantity * mapping;
}

export type VerifiedResolveResult = {
  items: ResolvedItem[];
  input_language: "english" | "filipino" | "taglish";
};

/**
 * Try to resolve a single-food input from the verified_foods table.
 * Returns null when the input doesn't map cleanly — the caller should fall
 * back to the AI parse path in that case.
 */
export async function lookupVerifiedFood(
  input: string,
  mealHint: "breakfast" | "lunch" | "dinner" | "snacks",
): Promise<VerifiedResolveResult | null> {
  const parsed = parseInput(input);
  if (!parsed) return null;

  const rows = await loadRows();
  if (rows.length === 0) return null;

  let row = matchRow(parsed.rest, rows);
  if (!row) return null;
  row = refineByPreparation(row, parsed.rest, rows);

  // Ambiguous raw/cooked with weight and no prep keyword → let the AI /
  // clarification path handle it so users see the raw/cooked prompt.
  if (
    AMBIGUOUS_PREP_CATEGORIES.has(row.category) &&
    parsed.hadWeight &&
    !parsed.hadPrepKeyword &&
    row.preparation_state !== "n_a"
  ) {
    return null;
  }

  const grams = computeGrams(parsed, row);
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return null;

  const factor = grams / 100;
  const item: ResolvedItem = {
    display_name: row.name,
    normalized_name: row.canonical_name,
    quantity: parsed.quantity,
    unit: parsed.unit ?? "serving",
    preparation: row.preparation_state === "n_a" ? null : row.preparation_state,
    meal_type: mealHint,
    calories: Math.round(row.kcal_per_100g * factor),
    protein_g: Math.round(row.protein_per_100g * factor),
    carbs_g: Math.round(row.carbs_per_100g * factor),
    fat_g: Math.round(row.fat_per_100g * factor),
    data_source: "verified_database",
    confidence: 0.95,
    is_estimate: false,
    clarification_needed: false,
    clarification_question: null,
  };

  return { items: [item], input_language: "english" };
}
