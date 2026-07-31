import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "log_food",
  title: "Log a food entry",
  description:
    "Add a food entry with its macros to the signed-in user's KainFit log. Use search_food_database first to get accurate per-100g nutrition, then scale it to the eaten amount.",
  inputSchema: {
    display_name: z.string().trim().min(1).describe("What was eaten, e.g. 'Chicken adobo'."),
    quantity: z.number().positive().describe("Amount eaten, in the given unit."),
    unit: z.string().trim().min(1).describe("Unit for the quantity, e.g. 'g', 'ml', 'piece'."),
    calories: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carbs_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    meal_type: z
      .enum(["breakfast", "lunch", "dinner", "snacks"])
      .optional()
      .describe("Defaults to snacks."),
    preparation: z
      .string()
      .trim()
      .optional()
      .describe("e.g. 'raw' or 'cooked' — important for rice, pasta and meat."),
    is_estimate: z.boolean().optional().describe("True when the macros are an estimate."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("food_entries")
      .insert({
        user_id: ctx.getUserId()!,
        display_name: input.display_name,
        quantity: input.quantity,
        unit: input.unit,
        calories: input.calories,
        protein_g: input.protein_g,
        carbs_g: input.carbs_g,
        fat_g: input.fat_g,
        meal_type: input.meal_type ?? "snacks",
        preparation: input.preparation ?? null,
        is_estimate: input.is_estimate ?? true,
        data_source: "mcp",
        original_input: input.display_name,
      })
      .select("id, display_name, quantity, unit, calories, protein_g, carbs_g, fat_g, logged_at")
      .single();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Logged: ${JSON.stringify(data)}` }],
      structuredContent: { entry: data },
    };
  },
});