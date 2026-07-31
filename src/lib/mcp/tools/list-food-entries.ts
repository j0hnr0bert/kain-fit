import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { manilaDate, manilaDayRange, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_food_entries",
  title: "List food entries",
  description:
    "List the signed-in user's KainFit food entries for one Manila calendar day (defaults to today).",
  inputSchema: {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Manila calendar day as YYYY-MM-DD. Defaults to today."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const day = date ?? manilaDate();
    const { startIso, endIso } = manilaDayRange(day);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("food_entries")
      .select(
        "id, display_name, quantity, unit, preparation, calories, protein_g, carbs_g, fat_g, is_estimate, logged_at",
      )
      .eq("user_id", ctx.getUserId()!)
      .gte("logged_at", startIso)
      .lt("logged_at", endIso)
      .order("logged_at", { ascending: true });

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const entries = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify({ date: day, entries }, null, 2) }],
      structuredContent: { date: day, count: entries.length, entries },
    };
  },
});