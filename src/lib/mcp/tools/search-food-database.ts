import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_food_database",
  title: "Search the food database",
  description:
    "Search KainFit's Filipino-first verified food database by name, brand or barcode. Returns per-100g nutrition so an amount can be scaled before logging.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Food name, local name, or brand."),
    barcode: z.string().trim().optional().describe("Exact product barcode, if known."),
    limit: z.number().int().optional().describe("Max results, 1-20. Defaults to 8."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, barcode, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const take = Math.min(Math.max(limit ?? 8, 1), 20);
    const supabase = supabaseForUser(ctx);
    const columns =
      "id, display_name, canonical_name, local_name, brand_name, category, preparation_state, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, default_serving_grams, common_serving_label, source, verified";

    let request = supabase.from("food_records").select(columns).eq("active", true);
    if (barcode) {
      request = request.eq("barcode", barcode);
    } else {
      const escaped = query.replace(/[%,]/g, " ").trim();
      request = request.or(
        `display_name.ilike.%${escaped}%,canonical_name.ilike.%${escaped}%,local_name.ilike.%${escaped}%,brand_name.ilike.%${escaped}%`,
      );
    }

    const { data, error } = await request
      .order("source_priority", { ascending: true, nullsFirst: false })
      .order("confidence_score", { ascending: false })
      .limit(take);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const results = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      structuredContent: { count: results.length, results },
    };
  },
});