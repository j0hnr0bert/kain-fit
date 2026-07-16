import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
- When a user gives a weight (grams) for foods whose nutrition materially changes based on preparation (raw meat/poultry/fish weight vs cooked, dry pasta vs cooked pasta, uncooked rice vs cooked rice) AND they did NOT explicitly say "raw", "cooked", "uncooked", "dry", or similar, you MUST set clarification_needed=true and clarification_question="Was that weighed raw or cooked?". In that case, provide the most reasonable middle-ground estimate and set is_estimate=true and preparation="estimated".
- Set meal_type based on the current local time hint provided by the user, defaulting to snacks when unclear.
- Never fabricate precision; round nutrition to whole numbers.
- Do NOT add coaching, judgement, or diet advice.`;

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

  if (res.status === 429) throw new Error("Too many requests — please try again in a moment.");
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

export const parseFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input: string; mealHint?: string }) => {
    if (!data?.input || typeof data.input !== "string" || data.input.trim().length === 0) {
      throw new Error("Please enter what you ate.");
    }
    if (data.input.length > 500) throw new Error("Description is too long.");
    return { input: data.input.trim(), mealHint: data.mealHint ?? "snacks" };
  })
  .handler(async ({ data }) => callParseAi(data.input, data.mealHint));

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
  const row = await getUsageRow(admin, sid);
  const count = row?.count ?? 0;
  return {
    limit: DEMO_PARSE_LIMIT,
    remaining: Math.max(0, DEMO_PARSE_LIMIT - count),
    used: Math.min(DEMO_PARSE_LIMIT, count),
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

    // Atomically reserve a slot BEFORE calling the AI so concurrent
    // requests cannot both pass a "count < limit" check.
    const reserveRes = await admin.rpc("reserve_demo_slot", {
      _sid: sid,
      _limit: DEMO_PARSE_LIMIT,
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
      const result = await callParseAi(data.input, data.mealHint);
      if (!result.items || result.items.length === 0) {
        // No usable result — release the slot.
        await admin.rpc("release_demo_slot", { _sid: sid, _reason: "empty_result" });
        return {
          ...result,
          remaining: Math.max(0, DEMO_PARSE_LIMIT - (reservedCount - 1)),
        };
      }
      await admin.rpc("mark_demo_success", { _sid: sid });
      return {
        ...result,
        remaining: Math.max(0, DEMO_PARSE_LIMIT - reservedCount),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 100) : "parse_failed";
      await admin.rpc("release_demo_slot", { _sid: sid, _reason: reason });
      throw err;
    }
  });