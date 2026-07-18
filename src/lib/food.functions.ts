import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// Namespace import so client-side `import * as nodeCrypto from "crypto"` does
// NOT eagerly access `.createHash`. Vite's crypto stub throws on any property
// access, which used to break the whole client bundle for this file.
// `buildCacheKey` runs only inside server-only code paths, so accessing
// `.createHash` there is safe.
import * as nodeCrypto from "crypto";

const itemSchema = z.object({
  display_name: z.string(),
  normalized_name: z.string(),
  quantity: z.number().nonnegative(),
  unit: z.string(),
  preparation: z.string().nullable().optional(),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snacks"]),
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  data_source: z.string(),
  confidence: z.number().min(0).max(1),
  is_estimate: z.boolean(),
  clarification_needed: z.boolean().default(false),
  clarification_question: z.string().nullable().optional(),
});

const responseSchema = z.object({
  items: z.array(itemSchema),
  input_language: z.string(),
});

// Schema returned by the single-item recalculation endpoint.
// Only the fields that can change with preparation/quantity are returned.
const recalcSchema = z.object({
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  data_source: z.string(),
  confidence: z.number().min(0).max(1),
  is_estimate: z.boolean(),
});

const SYSTEM_PROMPT = `You are KainFit's food-parsing engine, built for Filipino users.

Your job: turn a user's natural-language description of what they ate (English, Filipino, or Taglish) into structured nutrition items. Support common Philippine foods (adobo, sinigang, tapsilog, pandesal, lechon kawali, bangus, arroz caldo, giniling, Jollibee items, etc.) and common serving language (grams, cups, tablespoons, teaspoons, pieces, bowls, servings, packs, cans, "isang mangkok", "kalahating cup").

Rules:
- Split mixed meals into separate items (e.g. "150g chicken adobo and 200g rice" -> two items).
- Use grams for weight-based items when quantity is given in grams; otherwise use the user's stated unit.
- Provide realistic per-item calories, protein_g, carbs_g, fat_g based on typical Filipino preparation.
- Set data_source to "verified_database" if the food is a standard well-known dish, "recipe_based" if you inferred from ingredients, or "estimated" otherwise.
- Set is_estimate to true unless you are highly confident.
- confidence must be between 0 and 1.
- If the description is genuinely ambiguous, set clarification_needed=true and provide a short clarification_question. Otherwise clarification_needed=false and clarification_question=null.
- When a user gives a weight (grams, kg, oz, lb) for foods whose nutrition materially changes based on preparation — including but not limited to raw vs cooked meat/poultry/fish, dry vs cooked pasta or noodles, uncooked vs cooked rice, dry vs cooked oats or other grains (quinoa, barley, bulgur), and dry vs cooked beans/legumes — AND they did NOT explicitly say "raw", "cooked", "uncooked", "dry", "boiled", "steamed", or a similar unambiguous preparation word, you MUST set clarification_needed=true and clarification_question="Was that weighed raw or cooked?". In that case, provide the most reasonable middle-ground estimate, set is_estimate=true, set preparation="estimated", and NEVER silently assume raw or cooked.
- Set meal_type based on the current local time hint provided by the user, defaulting to snacks when unclear.
- Never fabricate precision; round nutrition to whole numbers.
- Do NOT add coaching, judgement, or diet advice.`;

const RECALC_SYSTEM_PROMPT = `You are KainFit's nutrition recalculation engine.

Given a single food item with an updated preparation, quantity, or unit, return
its recalculated nutrition. Use the verified per-100g reference that matches
the preparation the user selected:
- "raw" → uncooked/raw reference values (before water loss, water absorption,
  or oil absorption).
- "cooked" → cooked/prepared reference values (accounting for water loss in
  meats/fish, water absorption in rice/pasta, and typical oil absorption for
  common Filipino cooking methods).
- "estimated" → use the most reasonable middle-ground assumption for that
  specific food (for example, most home cooks weigh raw meat but cooked rice),
  set is_estimate=true, and set data_source="estimated".

Rules:
- Raw and cooked values MUST differ whenever the underlying reference differs
  (chicken, beef, pork, fish, rice, pasta, oats, potato, etc.). Never return
  identical macros for raw vs cooked for these foods.
- Round all nutrition fields to whole numbers.
- confidence between 0 and 1.
- data_source: "verified_database" for well-known foods you're confident about;
  "recipe_based" if inferred from ingredients; "estimated" otherwise.
- Never invent precision or add coaching.`;

// Well-known Filipino / prepared dishes. Their identity is inherently
// "cooked" — asking raw vs cooked makes no sense, so we suppress any AI
// clarification and lock preparation to "cooked".
const PREPARED_DISH_TOKENS = [
  "adobo",
  "sinigang",
  "tapsilog",
  "tocilog",
  "longsilog",
  "silog",
  "sisig",
  "lechon",
  "kaldereta",
  "caldereta",
  "menudo",
  "afritada",
  "giniling",
  "tinola",
  "nilaga",
  "bulalo",
  "kare-kare",
  "kare kare",
  "pinakbet",
  "bicol express",
  "ginataan",
  "laing",
  "dinuguan",
  "paksiw",
  "embutido",
  "arroz caldo",
  "lugaw",
  "champorado",
  "pancit",
  "lumpia",
  "fried rice",
  "garlic rice",
  "sinangag",
  "curry",
  "stew",
  "soup",
  "omelet",
  "omelette",
  "scrambled",
  "sunny side",
  "hard boiled",
  "soft boiled",
  "poached",
];

const EXPLICIT_COOKED_RE =
  /\b(cooked|boiled|steamed|grilled|fried|deep[-\s]?fried|pan[-\s]?fried|baked|roasted|braised|saut[eé]ed|stewed|prepared|scrambled|poached|toasted|smoked|BBQ|barbecue|barbecued)\b/i;
const EXPLICIT_RAW_RE = /\b(raw|uncooked|dry)\b/i;

function splitFragments(input: string): string[] {
  return input
    .split(/\s+(?:and|with|plus)\s+|[,;+&]/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPrepClarificationQ(q: string | null | undefined): boolean {
  if (!q) return false;
  const s = q.toLowerCase();
  return (
    s.includes("raw") ||
    s.includes("cooked") ||
    s.includes("weighed") ||
    s.includes("preparation") ||
    s.includes("prep")
  );
}

function fragmentForItem(fragments: string[], displayName: string, normalizedName: string): string | null {
  const nameTokens = `${displayName} ${normalizedName}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
  let best: { frag: string; score: number } | null = null;
  for (const frag of fragments) {
    const f = frag.toLowerCase();
    let score = 0;
    for (const tok of nameTokens) if (f.includes(tok)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { frag, score };
  }
  return best?.frag ?? null;
}

function isPreparedDish(displayName: string, normalizedName: string): boolean {
  const hay = `${displayName} ${normalizedName}`.toLowerCase();
  return PREPARED_DISH_TOKENS.some((tok) => hay.includes(tok));
}

// Post-process the AI parse so obviously-answered raw/cooked questions
// don't get bounced back to the user. Runs on the server, before caching,
// so cache entries are already clean.
function suppressSpuriousPrepClarifications(
  input: string,
  parsed: z.infer<typeof responseSchema>,
): z.infer<typeof responseSchema> {
  const fragments = splitFragments(input);
  const wholeCooked = EXPLICIT_COOKED_RE.test(input);
  const wholeRaw = EXPLICIT_RAW_RE.test(input);

  return {
    ...parsed,
    items: parsed.items.map((item) => {
      if (!item.clarification_needed || !isPrepClarificationQ(item.clarification_question)) {
        return item;
      }
      const frag = fragmentForItem(fragments, item.display_name, item.normalized_name);
      const fragCooked = frag ? EXPLICIT_COOKED_RE.test(frag) : false;
      const fragRaw = frag ? EXPLICIT_RAW_RE.test(frag) : false;

      let prep: "raw" | "cooked" | null = null;
      if (fragCooked) prep = "cooked";
      else if (fragRaw) prep = "raw";
      else if (isPreparedDish(item.display_name, item.normalized_name)) prep = "cooked";
      else if (fragments.length <= 1 && wholeCooked && !wholeRaw) prep = "cooked";
      else if (fragments.length <= 1 && wholeRaw && !wholeCooked) prep = "raw";

      if (!prep) return item;
      return {
        ...item,
        preparation: prep,
        clarification_needed: false,
        clarification_question: null,
        is_estimate: item.is_estimate && prep !== "cooked" ? item.is_estimate : item.is_estimate,
      };
    }),
  };
}

async function callParseAi(input: string, mealHint: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured. Please contact support.");
  const userPrompt = `Current meal hint (from local time): ${mealHint}\n\nUser said: "${input}"\n\nReturn a JSON object matching this shape:\n{\n  "items": [\n    {\n      "display_name": string,\n      "normalized_name": string,\n      "quantity": number,\n      "unit": string,\n      "preparation": string | null,\n      "meal_type": "breakfast" | "lunch" | "dinner" | "snacks",\n      "calories": number,\n      "protein_g": number,\n      "carbs_g": number,\n      "fat_g": number,\n      "data_source": "verified_database" | "recipe_based" | "estimated" | "user_confirmed",\n      "confidence": number,\n      "is_estimate": boolean,\n      "clarification_needed": boolean,\n      "clarification_question": string | null\n    }\n  ],\n  "input_language": "english" | "filipino" | "taglish"\n}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) {
    const { AiRateLimitError } = await import("./ai-guard.server");
    const retryAfter = res.headers.get("retry-after");
    const parsed = retryAfter ? Number(retryAfter) : NaN;
    throw new AiRateLimitError(Number.isFinite(parsed) ? parsed * 1000 : null);
  }
  if (res.status === 402) throw new Error("AI credits exhausted. Please contact the app owner.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("AI gateway error", res.status, text);
    throw new Error("Could not interpret your food. Please try again.");
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned an invalid response. Please try again.");
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    console.error("Schema validation failed", result.error.flatten());
    throw new Error("AI returned an unexpected shape. Please try again.");
  }
  return result.data;
}

async function callRecalcAi(item: {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation: string;
}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured. Please contact support.");
  const userPrompt = `Recalculate nutrition for this single food.\n\nFood: ${item.display_name}\nNormalized name: ${item.normalized_name}\nQuantity: ${item.quantity}\nUnit: ${item.unit}\nPreparation: ${item.preparation}\n\nReturn a JSON object matching:\n{\n  "calories": number,\n  "protein_g": number,\n  "carbs_g": number,\n  "fat_g": number,\n  "data_source": "verified_database" | "recipe_based" | "estimated" | "user_confirmed",\n  "confidence": number,\n  "is_estimate": boolean\n}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: RECALC_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) {
    const { AiRateLimitError } = await import("./ai-guard.server");
    const retryAfter = res.headers.get("retry-after");
    const parsed = retryAfter ? Number(retryAfter) : NaN;
    throw new AiRateLimitError(Number.isFinite(parsed) ? parsed * 1000 : null);
  }
  if (res.status === 402) throw new Error("AI credits exhausted. Please contact the app owner.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("AI recalc error", res.status, text);
    throw new Error("Could not recalculate nutrition. Please try again.");
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned an invalid response. Please try again.");
  }
  const result = recalcSchema.safeParse(parsed);
  if (!result.success) {
    console.error("Recalc schema validation failed", result.error.flatten());
    throw new Error("AI returned an unexpected shape. Please try again.");
  }
  return result.data;
}

const recalcInputValidator = (data: {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation: "raw" | "cooked" | "estimated";
}) => {
  if (!data?.display_name || typeof data.display_name !== "string") {
    throw new Error("Missing food name.");
  }
  if (!(data.quantity >= 0) || !Number.isFinite(data.quantity)) {
    throw new Error("Invalid quantity.");
  }
  if (!data.unit || typeof data.unit !== "string") throw new Error("Missing unit.");
  const prep = data.preparation;
  if (prep !== "raw" && prep !== "cooked" && prep !== "estimated") {
    throw new Error("Invalid preparation.");
  }
  return {
    display_name: data.display_name.trim().slice(0, 200),
    normalized_name: (data.normalized_name ?? data.display_name).toString().trim().slice(0, 200),
    quantity: data.quantity,
    unit: data.unit.trim().slice(0, 40),
    preparation: prep,
  };
};

// Authenticated recalc for logged-in users. Does not touch demo quotas.
export const recalcItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(recalcInputValidator)
  .handler(async ({ data }) => {
    const { guardedAiCall } = await import("./ai-guard.server");
    return mapGuardErrors(() => guardedAiCall(() => callRecalcAi(data)));
  });

// Demo recalc — anonymous, but DOES NOT consume a demo calculation slot.
// Answering a clarification or changing preparation is not a new calculation.
export const recalcItemDemo = createServerFn({ method: "POST" })
  .inputValidator(recalcInputValidator)
  .handler(async ({ data }) => {
    const { guardedAiCall } = await import("./ai-guard.server");
    return mapGuardErrors(() => guardedAiCall(() => callRecalcAi(data)));
  });

export const parseFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input: string; mealHint?: string }) => {
    if (!data?.input || typeof data.input !== "string" || data.input.trim().length === 0) {
      throw new Error("Please enter what you ate.");
    }
    if (data.input.length > 500) throw new Error("Description is too long.");
    return { input: data.input.trim(), mealHint: data.mealHint ?? "snacks" };
  })
  .handler(async ({ data, context }) => {
    const {
      singleFlight,
      allowBurst,
      getGlobalAiCounts,
      getUserDailyAiCount,
      getUserDailySubmissionCount,
    } = await import("./ai-guard.server");
    const { readOpsSettings } = await import("./ops-settings.server");
    const settings = await readOpsSettings();
    if (settings.pause_ai || settings.db_only_mode) {
      throw new Error(
        "AI_UNAVAILABLE: KainFit's calculator is temporarily paused. You can still edit, delete, or add entries manually.",
      );
    }
    // Beta submission cap: PHT-day counted successful submissions per user.
    if (settings.beta_limits_enabled && settings.beta_daily_submission_cap > 0) {
      const used = await getUserDailySubmissionCount(context.userId);
      if (used >= settings.beta_daily_submission_cap) {
        throw new Error(
          "BETA_LIMIT: You've reached today's beta limit. Your allowance resets at midnight. Existing entries can still be edited.",
        );
      }
    }
    // Enforce founder-tunable per-submission length cap.
    if (settings.beta_max_input_length > 0 && data.input.length > settings.beta_max_input_length) {
      throw new Error(`Description is too long (max ${settings.beta_max_input_length} characters).`);
    }
    // Global monthly cap: hard stop above configured ceiling.
    if (settings.monthly_ai_call_cap > 0) {
      const { month } = await getGlobalAiCounts();
      if (month >= settings.monthly_ai_call_cap) {
        throw new Error(
          "AI_UNAVAILABLE: We've hit today's calculator budget. You can still edit or add entries manually.",
        );
      }
    }
    // Per-user daily cap: prevent one account from burning the budget.
    if (settings.user_daily_ai_cap > 0) {
      const used = await getUserDailyAiCount(context.userId);
      if (used >= settings.user_daily_ai_cap) {
        throw new Error(
          "AI_BUSY: You've hit today's calculation limit. Please come back tomorrow or add entries manually.",
        );
      }
    }
    // Per-user burst limit: reject taps beyond N per rolling minute.
    if (!allowBurst(`user:${context.userId}`, settings.session_burst_per_min)) {
      throw new Error("AI_BUSY: Too many requests. Please wait a moment and try again.");
    }
    const key = `parse:user:${context.userId}:${buildCacheKey(data.input, data.mealHint)}`;
    const result = await mapGuardErrors(() =>
      singleFlight(key, () => resolveWithCache(data.input, data.mealHint)),
    );
    // Founder-tunable cap on how many foods a single submission can produce.
    if (
      settings.beta_max_foods_per_submission > 0 &&
      Array.isArray(result.items) &&
      result.items.length > settings.beta_max_foods_per_submission
    ) {
      throw new Error(
        `BETA_LIMIT: Too many foods in one entry — max ${settings.beta_max_foods_per_submission}. Please split it up.`,
      );
    }
    return result;
  });

// Translates internal guard errors into user-visible messages.
// The prefix `AI_UNAVAILABLE:` / `AI_BUSY:` lets the client route to fallbacks.
async function mapGuardErrors<T>(fn: () => Promise<T>): Promise<T> {
  const { AiUnavailableError, AiBusyError } = await import("./ai-guard.server");
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      throw new Error(
        "AI_UNAVAILABLE: KainFit's calculator is temporarily unavailable. You can still edit, delete, or add entries manually.",
      );
    }
    if (err instanceof AiBusyError) {
      throw new Error(
        "AI_BUSY: Demand is unusually high. Please wait a moment and try again.",
      );
    }
    throw err;
  }
}

// ============================================================
// Fast resolution pipeline
// ============================================================

function normalizeForKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCacheKey(input: string, mealHint: string): string {
  return nodeCrypto.createHash("sha256")
    .update(`${normalizeForKey(input)}|${mealHint}`)
    .digest("hex");
}

type CacheAdmin = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type ResolveResult = z.infer<typeof responseSchema> & {
  timings: {
    ai_parsing_ms: number;
    resolution_path: "verified_db" | "cache" | "ai_parse";
    cache_hit: boolean;
  };
};

export async function resolveWithCache(input: string, mealHint: string): Promise<ResolveResult> {
  const key = buildCacheKey(input, mealHint);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as CacheAdmin;

  // Tier 0: verified_foods DB — single-item, unambiguous inputs bypass AI entirely.
  try {
    const { lookupVerifiedFood } = await import("./verified-foods.server");
    const mh = (mealHint === "breakfast" || mealHint === "lunch" || mealHint === "dinner"
      ? mealHint
      : "snacks") as "breakfast" | "lunch" | "dinner" | "snacks";
    const dbHit = await lookupVerifiedFood(input, mh);
    if (dbHit && dbHit.items.length > 0) {
      const parsed = responseSchema.safeParse(dbHit);
      if (parsed.success) {
        return {
          ...parsed.data,
          timings: { ai_parsing_ms: 0, resolution_path: "verified_db", cache_hit: true },
        };
      }
    }
  } catch (err) {
    console.error("[verified-foods] lookup failed", err);
    // fall through to cache/AI
  }

  // Tier: shared parse cache
  try {
    const cacheRes = await admin.rpc("get_food_parse_cache", { _key: key });
    if (!cacheRes.error && Array.isArray(cacheRes.data) && cacheRes.data.length > 0) {
      const row = cacheRes.data[0] as { items?: unknown; input_language?: unknown };
      const parsed = responseSchema.safeParse({
        items: row.items,
        input_language: typeof row.input_language === "string" ? row.input_language : "english",
      });
      if (parsed.success && parsed.data.items.length > 0) {
        return {
          ...parsed.data,
          timings: { ai_parsing_ms: 0, resolution_path: "cache", cache_hit: true },
        };
      }
    }
  } catch (err) {
    console.error("[cache] read failed", err);
    // fall through to AI
  }

  // Tier: AI fallback
  const t0 = Date.now();
  const { guardedAiCall } = await import("./ai-guard.server");
  const rawResult = await guardedAiCall(() => callParseAi(input, mealHint));
  const result = suppressSpuriousPrepClarifications(input, rawResult);
  const ai_parsing_ms = Date.now() - t0;

  // Write to cache — but only when the result looks reusable:
  // no clarification requested (otherwise the answer depends on the user)
  // and at least one item.
  const cacheable =
    result.items.length > 0 && !result.items.some((i) => i.clarification_needed);
  if (cacheable) {
    try {
      await admin.rpc("put_food_parse_cache", {
        _key: key,
        _meal_hint: mealHint,
        _items: result.items,
        _input_language: result.input_language,
      });
    } catch (err) {
      console.error("[cache] write failed", err);
    }
  }

  return {
    ...result,
    timings: { ai_parsing_ms, resolution_path: "ai_parse", cache_hit: false },
  };
}

// Public (unauthenticated) demo parse. Uses the same production pipeline,
// but is rate-limited per anonymous session and never persists results.
export const DEMO_PARSE_LIMIT = 3;

const DEMO_COOKIE = "kf_demo_sid";
const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function readOrIssueDemoSid(): { sid: string; issued: boolean } {
  const existing = getCookie(DEMO_COOKIE);
  if (existing && existing.length > 0 && existing.length <= 128) {
    return { sid: existing, issued: false };
  }
  const sid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setCookie(DEMO_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: DEMO_COOKIE_MAX_AGE,
  });
  return { sid, issued: true };
}

type DemoAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (t: string) => {
    select: (c: string) => {
      eq: (a: string, b: string) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

async function getUsageRow(admin: DemoAdmin, sid: string): Promise<{ count: number; last_success_at: string | null } | null> {
  const { data } = await admin
    .from("demo_usage")
    .select("count,last_success_at")
    .eq("session_id", sid);
  const row = Array.isArray(data) ? (data[0] as { count?: number; last_success_at?: string | null } | undefined) : undefined;
  if (!row) return null;
  return { count: Number(row.count ?? 0), last_success_at: row.last_success_at ?? null };
}

// Fetches the authoritative remaining demo allowance for this browser.
// Issues an httpOnly session cookie on first call.
export const getDemoStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { sid } = readOrIssueDemoSid();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as DemoAdmin;
  const { readOpsSettings } = await import("./ops-settings.server");
  const settings = await readOpsSettings();
  const limit = Math.max(1, Math.floor(settings.demo_allowance || DEMO_PARSE_LIMIT));
  const row = await getUsageRow(admin, sid);
  const count = row?.count ?? 0;
  return {
    limit,
    remaining: Math.max(0, limit - count),
    used: Math.min(limit, count),
  };
});

export const parseFoodDemo = createServerFn({ method: "POST" })
  .inputValidator((data: { input: string; mealHint?: string }) => {
    if (!data?.input || typeof data.input !== "string" || data.input.trim().length === 0) {
      throw new Error("Please enter what you ate.");
    }
    if (data.input.length > 500) throw new Error("Description is too long.");
    return { input: data.input.trim(), mealHint: data.mealHint ?? "snacks" };
  })
  .handler(async ({ data }) => {
    const { sid } = readOrIssueDemoSid();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as DemoAdmin;

    const { readOpsSettings } = await import("./ops-settings.server");
    const settings = await readOpsSettings();
    if (settings.pause_demo || settings.pause_ai || settings.db_only_mode) {
      throw new Error(
        "AI_UNAVAILABLE: The demo is temporarily paused. Please try again shortly or sign up to keep going.",
      );
    }
    const demoLimit = Math.max(1, Math.floor(settings.demo_allowance || DEMO_PARSE_LIMIT));

    // Global monthly cap: stop demo calls first when the budget is exhausted.
    if (settings.monthly_ai_call_cap > 0) {
      const { getGlobalAiCounts } = await import("./ai-guard.server");
      const { month } = await getGlobalAiCounts();
      if (month >= settings.monthly_ai_call_cap) {
        throw new Error(
          "AI_UNAVAILABLE: The demo is temporarily paused. Please try again shortly or sign up to keep going.",
        );
      }
    }
    // Per-session burst limit.
    {
      const { allowBurst } = await import("./ai-guard.server");
      if (!allowBurst(`demo:${sid}`, settings.session_burst_per_min)) {
        throw new Error("AI_BUSY: Too many requests. Please wait a moment and try again.");
      }
    }

    // Atomically reserve a slot BEFORE calling the AI so concurrent
    // requests cannot both pass a "count < limit" check.
    const reserveRes = await admin.rpc("reserve_demo_slot", {
      _sid: sid,
      _limit: demoLimit,
    });
    if (reserveRes.error) {
      console.error("[demo] reserve failed", reserveRes.error.message);
      throw new Error("Could not start demo calculation. Please try again.");
    }
    const reservedCount = Number(reserveRes.data ?? -1);
    if (reservedCount < 0) {
      throw new Error("DEMO_LIMIT_REACHED");
    }

    try {
      const { singleFlight } = await import("./ai-guard.server");
      const sfKey = `parse:demo:${sid}:${buildCacheKey(data.input, data.mealHint)}`;
      const resolved = await mapGuardErrors(() =>
        singleFlight(sfKey, () => resolveWithCache(data.input, data.mealHint)),
      );
      const { timings, ...result } = resolved;
      if (!result.items || result.items.length === 0) {
        // No usable result — release the slot.
        await admin.rpc("release_demo_slot", { _sid: sid, _reason: "empty_result" });
        return {
          ...result,
          remaining: Math.max(0, demoLimit - (reservedCount - 1)),
          timings,
        };
      }
      await admin.rpc("mark_demo_success", { _sid: sid });
      return {
        ...result,
        remaining: Math.max(0, demoLimit - reservedCount),
        timings,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 100) : "parse_failed";
      await admin.rpc("release_demo_slot", { _sid: sid, _reason: reason });
      throw err;
    }
  });