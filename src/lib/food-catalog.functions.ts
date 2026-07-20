// Unified food catalog service: single entry point for searching the
// food_records catalog and for bulk-importing new rows from a CSV.
// Structured so a future external nutrition API (USDA FDC,
// OpenFoodFacts, etc.) can be added as a fallback inside `searchFoods`
// without touching any calling UI.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------- Search ----------------

export type FoodSearchHit = {
  id: string;
  name: string;
  canonical_name: string;
  category: string;
  preparation_state: string;
  source: string | null;
  source_priority: number;
  brand: string | null;
  barcode: string | null;
  verified: boolean;
  last_verified_date: string | null;
  common_serving_label: string | null;
  default_serving_grams: number | null;
  per_100g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number | null;
    sodium_mg: number | null;
  };
  matched_alias: string | null;
  match_kind: "exact" | "prefix" | "partial" | "recent" | "frequent";
  score: number;
};

type RawFoodRow = {
  id: string;
  canonical_name: string;
  display_name: string;
  category: string;
  preparation_state: string;
  source: string | null;
  source_priority: number | string | null;
  brand_name: string | null;
  barcode: string | null;
  verified: boolean;
  last_verified_date: string | null;
  common_serving_label: string | null;
  default_serving_grams: number | string | null;
  calories_per_100g: number | string;
  protein_per_100g: number | string;
  carbs_per_100g: number | string;
  fat_per_100g: number | string;
  fiber_per_100g: number | string | null;
  sodium_mg_per_100g: number | string | null;
};

function toHit(row: RawFoodRow, match_kind: FoodSearchHit["match_kind"], score: number, matched_alias: string | null = null): FoodSearchHit {
  return {
    id: row.id,
    name: row.display_name,
    canonical_name: row.canonical_name,
    category: row.category,
    preparation_state: row.preparation_state,
    source: row.source,
    source_priority: row.source_priority == null ? 6 : Number(row.source_priority),
    brand: row.brand_name,
    barcode: row.barcode,
    verified: row.verified,
    last_verified_date: row.last_verified_date,
    common_serving_label: row.common_serving_label,
    default_serving_grams: row.default_serving_grams == null ? null : Number(row.default_serving_grams),
    per_100g: {
      calories: Number(row.calories_per_100g),
      protein_g: Number(row.protein_per_100g),
      carbs_g: Number(row.carbs_per_100g),
      fat_g: Number(row.fat_per_100g),
      fiber_g: row.fiber_per_100g == null ? null : Number(row.fiber_per_100g),
      sodium_mg: row.sodium_mg_per_100g == null ? null : Number(row.sodium_mg_per_100g),
    },
    matched_alias,
    match_kind,
    score,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

const FOOD_COLS =
  "id, canonical_name, display_name, category, preparation_state, source, source_priority, brand_name, barcode, verified, last_verified_date, common_serving_label, default_serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, sodium_mg_per_100g";

export const searchFoods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().trim().max(120).default(""),
        limit: z.number().int().min(1).max(50).default(20),
        include_personal: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supa = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: unknown) => unknown;
          or: (s: string) => unknown;
          in: (a: string, b: string[]) => unknown;
          order: (a: string, o: { ascending: boolean }) => unknown;
          limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
    const q = normalize(data.query);
    const limit = data.limit;
    const hitsById = new Map<string, FoodSearchHit>();

    // ---- barcode fast-path: 8-14 digits ----
    if (/^\d{8,14}$/.test(q)) {
      const bcRes = await (supa.from("food_records").select(FOOD_COLS) as unknown as {
        eq: (a: string, b: unknown) => {
          limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      }).eq("barcode", q).limit(5);
      const rows = (bcRes.data ?? []) as RawFoodRow[];
      for (const row of rows) hitsById.set(row.id, toHit(row, "exact", 2000));
      if (hitsById.size > 0) {
        const results = Array.from(hitsById.values()).slice(0, limit);
        return { results, source: "local_catalog" as const };
      }
    }

    // ---- personal: recent + frequent from food_entries ----
    if (data.include_personal) {
      try {
        const recentBuilder = (supa.from("food_entries").select("display_name, normalized_name, quantity, created_at") as unknown as {
          eq: (a: string, b: unknown) => {
            order: (a: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
            };
          };
        })
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false });
        const recentRes = await recentBuilder.limit(80);
        const recent = (recentRes.data ?? []) as Array<{ display_name: string; normalized_name: string | null }>;
        // dedupe by normalized_name preserving order
        const seen = new Set<string>();
        const recentNames: string[] = [];
        const freqCount = new Map<string, number>();
        for (const r of recent) {
          const key = (r.normalized_name ?? r.display_name ?? "").toLowerCase().trim();
          if (!key) continue;
          freqCount.set(key, (freqCount.get(key) ?? 0) + 1);
          if (!seen.has(key)) {
            seen.add(key);
            recentNames.push(key);
          }
        }
        // Match recent names against food_records by canonical_name OR alias.
        const wanted = recentNames.slice(0, 12);
        if (wanted.length > 0) {
          const rowsRes = await (supa.from("food_records").select(FOOD_COLS) as unknown as {
            in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
          }).in("canonical_name", wanted);
          const rows = (rowsRes.data ?? []) as RawFoodRow[];
          for (const row of rows) {
            const key = row.canonical_name.toLowerCase();
            const count = freqCount.get(key) ?? 1;
            const kind: FoodSearchHit["match_kind"] = count >= 3 ? "frequent" : "recent";
            // High score so personal hits sort above catalog matches.
            const score = 1000 + count * 10 + (kind === "frequent" ? 50 : 0);
            hitsById.set(row.id, toHit(row, kind, score));
          }
        }
      } catch {
        // Personal enrichment is best-effort; ignore and fall back to catalog.
      }
    }

    // ---- catalog search when a query is present ----
    if (q.length > 0) {
      // Exact match on canonical_name / display_name via lower().
      const like = q.replace(/[\\%_]/g, "\\$&");
      const orFilter = `canonical_name.ilike.${like}%,display_name.ilike.${like}%,brand_name.ilike.${like}%,canonical_name.ilike.%${like}%,display_name.ilike.%${like}%,brand_name.ilike.%${like}%`;
      const catRes = await (supa.from("food_records").select(FOOD_COLS) as unknown as {
        eq: (a: string, b: unknown) => {
          or: (s: string) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .eq("active", true)
        .or(orFilter)
        .limit(60);
      const rows = (catRes.data ?? []) as RawFoodRow[];
      for (const row of rows) {
        if (hitsById.has(row.id)) continue;
        const dn = row.display_name.toLowerCase();
        const cn = row.canonical_name.toLowerCase();
        const bn = (row.brand_name ?? "").toLowerCase();
        let kind: FoodSearchHit["match_kind"] = "partial";
        let score = 100;
        if (dn === q || cn === q) { kind = "exact"; score = 500; }
        else if (dn.startsWith(q) || cn.startsWith(q)) { kind = "prefix"; score = 300; }
        else if (bn && (bn === q || bn.startsWith(q))) { kind = "prefix"; score = 260; }
        hitsById.set(row.id, toHit(row, kind, score));
      }

      // Alias search: pull alias hits and merge (upgrade kind/score if better).
      const aliasRes = await (supa.from("food_aliases").select("food_record_id, alias, normalized_alias, priority") as unknown as {
        or: (s: string) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> };
      }).or(`normalized_alias.ilike.${like}%,normalized_alias.ilike.%${like}%`).limit(80);
      const aliasRows = (aliasRes.data ?? []) as Array<{ food_record_id: string; alias: string; normalized_alias: string; priority: number }>;
      const missingIds = aliasRows.map((a) => a.food_record_id).filter((id) => !hitsById.has(id));
      const uniqueMissing = Array.from(new Set(missingIds)).slice(0, 40);
      let missingRows: RawFoodRow[] = [];
      if (uniqueMissing.length > 0) {
        const mRes = await (supa.from("food_records").select(FOOD_COLS) as unknown as {
          eq: (a: string, b: unknown) => { in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }> };
        }).eq("active", true).in("id", uniqueMissing);
        missingRows = (mRes.data ?? []) as RawFoodRow[];
      }
      const rowById = new Map<string, RawFoodRow>();
      for (const r of missingRows) rowById.set(r.id, r);
      for (const a of aliasRows) {
        const row = rowById.get(a.food_record_id);
        if (row && !hitsById.has(row.id)) {
          const na = a.normalized_alias;
          let kind: FoodSearchHit["match_kind"] = "partial";
          let score = 90;
          if (na === q) { kind = "exact"; score = 480; }
          else if (na.startsWith(q)) { kind = "prefix"; score = 280; }
          // Higher-priority (lower number) aliases score slightly better.
          score += Math.max(0, 100 - a.priority);
          hitsById.set(row.id, toHit(row, kind, score, a.alias));
        }
      }
    }

    // Fallback: no local matches → try external commercial API stub. Anything
    // returned is materialized into food_records with source='commercial_api'
    // (verified=false) so future searches hit the local catalog.
    if (hitsById.size === 0 && q.length >= 2) {
      try {
        const fetched = await lookupExternalNutrition(q);
        if (fetched && fetched.length > 0) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as unknown as {
            from: (t: string) => {
              upsert: (rows: unknown, opts: { onConflict: string }) => {
                select: (c: string) => Promise<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
          const upRes = await admin
            .from("food_records")
            .upsert(fetched, { onConflict: "canonical_name" })
            .select(FOOD_COLS);
          const rows = (upRes.data ?? []) as RawFoodRow[];
          for (const row of rows) hitsById.set(row.id, toHit(row, "partial", 50));
        }
      } catch {
        // best-effort; caller still gets an empty result
      }
    }

    // Rank: personal hits first (their score is already >= 1000), then by
    // source_priority ascending, then by match score descending.
    const results = Array.from(hitsById.values())
      .sort((a, b) => {
        const aPersonal = a.match_kind === "recent" || a.match_kind === "frequent";
        const bPersonal = b.match_kind === "recent" || b.match_kind === "frequent";
        if (aPersonal !== bPersonal) return aPersonal ? -1 : 1;
        if (a.source_priority !== b.source_priority) return a.source_priority - b.source_priority;
        return b.score - a.score;
      })
      .slice(0, limit);
    return { results, source: "local_catalog" as const };
  });

// ---------------- External nutrition API fallback (stub) ----------------

/**
 * Single swappable entry point for querying an external commercial nutrition
 * API (Nutritionix / FatSecret / Edamam). Returns rows shaped for insertion
 * into food_records. Wire an actual provider by reading e.g.
 * process.env.NUTRITIONIX_APP_ID / _APP_KEY inside this handler. Returning
 * an empty array means "no upstream hit"; throwing bubbles up as a search
 * failure.
 */
export async function lookupExternalNutrition(
  _query: string,
): Promise<Array<{
  canonical_name: string;
  display_name: string;
  category: string;
  preparation_state: "raw" | "cooked" | "n_a";
  source: "commercial_api";
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number | null;
  sodium_mg_per_100g: number | null;
  default_serving_grams: number | null;
  common_serving_label: string | null;
  active: boolean;
}>> {
  // No provider wired yet. Add fetch(...) + normalization here later.
  return [];
}

// ---------------- Bulk import ----------------

const importRowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  alt_names: z.array(z.string().trim().min(1).max(80)).default([]),
  brand: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().regex(/^\d{8,14}$/).optional().nullable(),
  category: z.string().trim().min(1).max(40),
  source: z.enum([
    "philfct", "manufacturer", "restaurant", "openfoodfacts", "commercial_api", "manual",
  ]).default("manual"),
  per_100g_calories: z.coerce.number().min(0).max(1200),
  per_100g_protein_g: z.coerce.number().min(0).max(200).default(0),
  per_100g_carbs_g: z.coerce.number().min(0).max(200).default(0),
  per_100g_fat_g: z.coerce.number().min(0).max(200).default(0),
  per_100g_fiber_g: z.coerce.number().min(0).max(100).optional().nullable(),
  per_100g_sodium_mg: z.coerce.number().min(0).max(60000).optional().nullable(),
  common_serving_label: z.string().trim().max(80).optional().nullable(),
  common_serving_grams: z.coerce.number().min(0).max(5000).optional().nullable(),
  verified: z.union([z.boolean(), z.string()]).optional(),
  preparation_state: z.enum(["raw", "cooked", "n_a"]).default("n_a"),
  canonical_name: z.string().trim().min(1).max(120).optional(),
  last_verified_date: z.string().trim().optional().nullable(),
});

export type BulkImportRow = z.input<typeof importRowSchema>;

function canonicalize(name: string, prep: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return prep && prep !== "n_a" ? `${slug}_${prep}` : slug;
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return s === "" || s === "true" || s === "1" || s === "yes" || s === "y";
}

export const bulkImportFoods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        rows: z.array(importRowSchema).min(1).max(1000),
        source_override: z
          .enum(["philfct", "manufacturer", "restaurant", "openfoodfacts", "commercial_api", "manual"]) 
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Founder/admin only.
    const supa = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: string) => {
            in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
    const roleRes = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "founder"]);
    if (!roleRes.data || roleRes.data.length === 0) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { invalidateFoodRecordsCache } = await import("./food-records.server");

    type Payload = {
      canonical_name: string;
      display_name: string;
      category: string;
      preparation_state: "raw" | "cooked" | "n_a";
      default_serving_grams: number | null;
      calories_per_100g: number;
      protein_per_100g: number;
      carbs_per_100g: number;
      fat_per_100g: number;
      fiber_per_100g: number | null;
      sodium_mg_per_100g: number | null;
      common_serving_label: string | null;
      source: string;
      brand_name: string | null;
      barcode: string | null;
      last_verified_date: string | null;
      verified: boolean;
      active: boolean;
    };

    const payload: Payload[] = data.rows.map((r) => {
      const prep = r.preparation_state;
      const cn = r.canonical_name ?? canonicalize(r.name, prep);
      const src = data.source_override ?? r.source;
      const autoVerified = src === "philfct" || src === "manufacturer" || src === "restaurant";
      return {
        canonical_name: cn,
        display_name: r.name,
        category: r.category,
        preparation_state: prep,
        default_serving_grams: r.common_serving_grams ?? null,
        calories_per_100g: r.per_100g_calories,
        protein_per_100g: r.per_100g_protein_g,
        carbs_per_100g: r.per_100g_carbs_g,
        fat_per_100g: r.per_100g_fat_g,
        fiber_per_100g: r.per_100g_fiber_g ?? null,
        sodium_mg_per_100g: r.per_100g_sodium_mg ?? null,
        common_serving_label: r.common_serving_label ?? null,
        source: src,
        brand_name: r.brand ?? null,
        barcode: r.barcode ?? null,
        last_verified_date: r.last_verified_date ?? null,
        // If the caller explicitly passed verified, respect it; else let the
        // DB trigger set it from the source tier.
        verified: r.verified === undefined ? autoVerified : toBool(r.verified),
        active: true,
      };
    });

    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        upsert: (rows: unknown, opts: { onConflict: string }) => {
          select: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
        insert: (rows: unknown) => Promise<{ error: { message: string } | null }>;
      };
    };
    const upsertRes = await admin
      .from("food_records")
      .upsert(payload, { onConflict: "canonical_name" })
      .select("id, canonical_name");
    if (upsertRes.error) throw new Error(`Import failed: ${upsertRes.error.message}`);
    const written = (upsertRes.data ?? []) as Array<{ id: string; canonical_name: string }>;
    const idByCanon = new Map(written.map((w) => [w.canonical_name, w.id]));

    // Aliases: display name + supplied alt_names. Ignore alias failures.
    const aliasRows: Array<{ food_record_id: string; alias: string; normalized_alias: string; alias_type: string; priority: number }> = [];
    for (const r of data.rows) {
      const cn = r.canonical_name ?? canonicalize(r.name, r.preparation_state);
      const id = idByCanon.get(cn);
      if (!id) continue;
      const seen = new Set<string>();
      const push = (alias: string, type: "canonical" | "nickname", priority: number) => {
        const norm = alias.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
        if (!norm || seen.has(norm)) return;
        seen.add(norm);
        aliasRows.push({ food_record_id: id, alias, normalized_alias: norm, alias_type: type, priority });
      };
      push(r.name, "canonical", 10);
      for (const alt of r.alt_names ?? []) push(alt, "nickname", 60);
    }
    if (aliasRows.length > 0) {
      const aliasAdmin = supabaseAdmin as unknown as {
        from: (t: string) => {
          upsert: (rows: unknown, opts: { onConflict: string; ignoreDuplicates: boolean }) => Promise<{ error: unknown }>;
        };
      };
      await aliasAdmin
        .from("food_aliases")
        .upsert(aliasRows, { onConflict: "normalized_alias,food_record_id", ignoreDuplicates: true });
    }

    invalidateFoodRecordsCache();
    return { imported: written.length, aliases: aliasRows.length };
  });

// ---------------- CSV parser (client-safe) ----------------

/**
 * Minimal RFC-4180-ish CSV parser: quoted fields, embedded commas, doubled
 * quotes, CRLF/LF line endings. Returns an array of records keyed by the
 * header row. Kept dependency-free so the admin bundle stays small.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? "").trim(); });
    return rec;
  });
}

const CSV_COLUMN_ALIASES: Record<string, string> = {
  name: "name",
  display_name: "name",
  alt_names: "alt_names",
  aliases: "alt_names",
  category: "category",
  source: "source",
  per_100g_calories: "per_100g_calories",
  calories: "per_100g_calories",
  per_100g_protein_g: "per_100g_protein_g",
  protein: "per_100g_protein_g",
  protein_g: "per_100g_protein_g",
  per_100g_carbs_g: "per_100g_carbs_g",
  carbs: "per_100g_carbs_g",
  carbs_g: "per_100g_carbs_g",
  per_100g_fat_g: "per_100g_fat_g",
  fat: "per_100g_fat_g",
  fat_g: "per_100g_fat_g",
  per_100g_fiber_g: "per_100g_fiber_g",
  fiber: "per_100g_fiber_g",
  fiber_g: "per_100g_fiber_g",
  per_100g_sodium_mg: "per_100g_sodium_mg",
  sodium: "per_100g_sodium_mg",
  sodium_mg: "per_100g_sodium_mg",
  common_serving_label: "common_serving_label",
  serving_label: "common_serving_label",
  common_serving_grams: "common_serving_grams",
  serving_grams: "common_serving_grams",
  verified: "verified",
  preparation_state: "preparation_state",
  preparation: "preparation_state",
  canonical_name: "canonical_name",
};

export type CsvMappingResult = {
  rows: BulkImportRow[];
  errors: Array<{ line: number; reason: string }>;
};

export function mapCsvRows(records: Record<string, string>[]): CsvMappingResult {
  const rows: BulkImportRow[] = [];
  const errors: CsvMappingResult["errors"] = [];
  records.forEach((raw, idx) => {
    const line = idx + 2; // header is line 1
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = CSV_COLUMN_ALIASES[k.toLowerCase().trim()];
      if (key) mapped[key] = v;
    }
    if (!mapped.name) {
      errors.push({ line, reason: "missing 'name' column" });
      return;
    }
    if (!mapped.category) {
      errors.push({ line, reason: "missing 'category' column" });
      return;
    }
    const alt = (mapped.alt_names ?? "")
      .split(/[|;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const rowInput: BulkImportRow = {
      name: mapped.name,
      alt_names: alt,
      category: mapped.category,
      source: mapped.source ? mapped.source : "manual",
      per_100g_calories: mapped.per_100g_calories as unknown as number,
      per_100g_protein_g: (mapped.per_100g_protein_g ?? "0") as unknown as number,
      per_100g_carbs_g: (mapped.per_100g_carbs_g ?? "0") as unknown as number,
      per_100g_fat_g: (mapped.per_100g_fat_g ?? "0") as unknown as number,
      per_100g_fiber_g: mapped.per_100g_fiber_g ? (mapped.per_100g_fiber_g as unknown as number) : null,
      per_100g_sodium_mg: mapped.per_100g_sodium_mg ? (mapped.per_100g_sodium_mg as unknown as number) : null,
      common_serving_label: mapped.common_serving_label || null,
      common_serving_grams: mapped.common_serving_grams ? (mapped.common_serving_grams as unknown as number) : null,
      verified: mapped.verified,
      preparation_state: (mapped.preparation_state as "raw" | "cooked" | "n_a") || "n_a",
      canonical_name: mapped.canonical_name || undefined,
    };
    const parsed = importRowSchema.safeParse(rowInput);
    if (!parsed.success) {
      errors.push({ line, reason: parsed.error.issues[0]?.message ?? "invalid row" });
      return;
    }
    rows.push(parsed.data as BulkImportRow);
  });
  return { rows, errors };
}