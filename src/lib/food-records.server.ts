// Server-only resolver for the new normalized food_records catalog.
// Runs BEFORE the legacy verified_foods lookup. Conservative on purpose:
// only fires for single-food inputs that map cleanly to one record, and
// bails on multi-item / ambiguous raw-vs-cooked cases so the AI +
// clarification path stays in charge.

type Row = {
  id: string;
  canonical_name: string;
  display_name: string;
  category: string;
  preparation_state: "raw" | "cooked" | "n_a";
  preparation_variant: string | null;
  default_serving_grams: number | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

type Alias = {
  food_record_id: string;
  normalized_alias: string;
  priority: number;
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
let rowsCache: { at: number; rows: Row[]; aliases: Alias[] } | null = null;

async function loadCatalog(): Promise<{ rows: Row[]; aliases: Alias[] }> {
  const now = Date.now();
  if (rowsCache && now - rowsCache.at < CACHE_TTL_MS) {
    return { rows: rowsCache.rows, aliases: rowsCache.aliases };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: boolean) => Promise<{ data: unknown[] | null; error: unknown }>;
      } & Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
  const [rRes, aRes] = await Promise.all([
    admin
      .from("food_records")
      .select(
        "id,canonical_name,display_name,category,preparation_state,preparation_variant,default_serving_grams,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g",
      )
      .eq("active", true),
    admin.from("food_aliases").select("food_record_id,normalized_alias,priority"),
  ]);
  const rows = ((rRes.data ?? []) as Row[]).map((r) => ({
    ...r,
    calories_per_100g: Number(r.calories_per_100g),
    protein_per_100g: Number(r.protein_per_100g),
    carbs_per_100g: Number(r.carbs_per_100g),
    fat_per_100g: Number(r.fat_per_100g),
    default_serving_grams: r.default_serving_grams != null ? Number(r.default_serving_grams) : null,
  }));
  const aliases = (aRes.data ?? []) as Alias[];
  rowsCache = { at: now, rows, aliases };
  return { rows, aliases };
}

export function invalidateFoodRecordsCache(): void {
  rowsCache = null;
}

const CONJUNCTION_RE = /(?:\band\b|\bwith\b|\bplus\b|,|;|\+|&)/i;
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
const AMBIGUOUS_PREP_CATEGORIES = new Set(["grain", "meat", "fish"]);

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

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

type Parsed = {
  quantity: number;
  unit: string | null;
  rest: string;
  hadWeight: boolean;
  hadPrepKeyword: boolean;
};

function parseInput(raw: string): Parsed | null {
  const s = normalize(raw);
  if (!s) return null;
  if (CONJUNCTION_RE.test(s)) return null;
  const hadPrepKeyword = PREP_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(s));
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
  return { quantity: 1, unit: null, rest: s, hadWeight: false, hadPrepKeyword };
}

function findRow(rest: string, rows: Row[], aliases: Alias[]): Row | null {
  const target = normalize(rest);
  const stripped = target
    .replace(/\b(raw|uncooked|dry|cooked|boiled|steamed|grilled|fried|baked|roasted)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = Array.from(new Set([target, stripped].filter(Boolean)));

  // 1) Exact alias match, sort by priority ascending (canonical=10, others=50).
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const aliasMatches: Array<{ row: Row; prio: number }> = [];
  for (const cand of candidates) {
    for (const a of aliases) {
      if (a.normalized_alias === cand) {
        const row = rowById.get(a.food_record_id);
        if (row) aliasMatches.push({ row, prio: a.priority });
      }
    }
  }
  if (aliasMatches.length > 0) {
    aliasMatches.sort((x, y) => x.prio - y.prio);
    return aliasMatches[0].row;
  }

  // 2) Exact canonical / display fallback.
  for (const cand of candidates) {
    for (const row of rows) {
      if (normalize(row.canonical_name) === cand) return row;
      if (normalize(row.display_name) === cand) return row;
    }
  }
  return null;
}

function refineByPreparation(row: Row, rest: string, rows: Row[]): Row {
  const t = normalize(rest);
  const wantsRaw = /\b(raw|uncooked|dry)\b/.test(t);
  const wantsCooked = /\b(cooked|boiled|steamed|grilled|fried|baked|roasted)\b/.test(t);
  if (!wantsRaw && !wantsCooked) return row;
  if (wantsRaw && row.preparation_state === "raw") return row;
  if (wantsCooked && row.preparation_state === "cooked") return row;
  // Look for a sibling record in the same family with the desired state.
  const family = row.canonical_name.replace(/_(raw|cooked)$/, "");
  const wantState: "raw" | "cooked" = wantsRaw ? "raw" : "cooked";
  const alt = rows.find(
    (r) => r.preparation_state === wantState && r.canonical_name.startsWith(family),
  );
  return alt ?? row;
}

function computeGrams(parsed: Parsed, row: Row): number | null {
  const unit = parsed.unit;
  if (!unit) return parsed.quantity * (row.default_serving_grams ?? 100);
  const mapping = UNIT_TO_GRAMS[unit];
  if (mapping === undefined) return null;
  if (mapping === "use_default") return parsed.quantity * (row.default_serving_grams ?? 100);
  return parsed.quantity * mapping;
}

export type FoodRecordsResolveResult = {
  items: ResolvedItem[];
  input_language: "english" | "filipino" | "taglish";
};

export async function lookupFoodRecord(
  input: string,
  mealHint: "breakfast" | "lunch" | "dinner" | "snacks",
): Promise<FoodRecordsResolveResult | null> {
  const parsed = parseInput(input);
  if (!parsed) return null;
  const { rows, aliases } = await loadCatalog();
  if (rows.length === 0) return null;

  let row = findRow(parsed.rest, rows, aliases);
  if (!row) return null;
  row = refineByPreparation(row, parsed.rest, rows);

  // Ambiguous raw vs cooked on grain/meat/fish weight without a prep keyword
  // — bail so the AI clarification prompt fires.
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
    display_name: row.display_name,
    normalized_name: row.canonical_name,
    quantity: parsed.quantity,
    unit: parsed.unit ?? "serving",
    preparation: row.preparation_state === "n_a" ? null : row.preparation_state,
    meal_type: mealHint,
    calories: Math.round(row.calories_per_100g * factor),
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