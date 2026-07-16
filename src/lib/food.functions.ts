import { createServerFn } from "@tanstack/react-start";
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

export const parseFoodDemo = createServerFn({ method: "POST" })
  .inputValidator((data: { input: string; mealHint?: string; anonymousSessionId: string }) => {
    if (!data?.input || typeof data.input !== "string" || data.input.trim().length === 0) {
      throw new Error("Please enter what you ate.");
    }
    if (data.input.length > 500) throw new Error("Description is too long.");
    const sid = String(data.anonymousSessionId ?? "").trim();
    if (!sid || sid.length > 128) throw new Error("Session missing.");
    return { input: data.input.trim(), mealHint: data.mealHint ?? "snacks", sid };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (
          c: string,
          opts?: { count?: "exact"; head?: boolean },
        ) => {
          eq: (a: string, b: string) => {
            eq: (a: string, b: string) => {
              gt: (a: string, b: string) => Promise<{ count: number | null; error: unknown }>;
            };
          };
        };
        insert: (r: unknown) => Promise<{ error: { message: string } | null }>;
      };
    };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("product_events")
      .select("id", { count: "exact", head: true })
      .eq("anonymous_session_id", data.sid)
      .eq("event_name", "demo_food_confirmed")
      .gt("created_at", since);

    if ((count ?? 0) >= DEMO_PARSE_LIMIT) {
      const err = new Error("DEMO_LIMIT_REACHED");
      throw err;
    }

    const result = await callParseAi(data.input, data.mealHint);

    // Record a server-side successful demo parse so rate limiting is authoritative.
    await admin.from("product_events").insert({
      user_id: null,
      anonymous_session_id: data.sid,
      event_name: "demo_food_confirmed",
      acquisition_source: null,
      event_properties: {
        number_of_items: result.items.length,
        input_language: result.input_language,
      },
    });

    return {
      ...result,
      remaining: Math.max(0, DEMO_PARSE_LIMIT - ((count ?? 0) + 1)),
    };
  });