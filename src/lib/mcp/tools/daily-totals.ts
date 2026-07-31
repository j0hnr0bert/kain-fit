import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { manilaDate, manilaDayRange, supabaseForUser } from "../supabase";

export default defineTool({
  name: "daily_totals",
  title: "Daily macro totals",
  description:
    "Total calories, protein, carbs and fat the signed-in user logged on one Manila calendar day (defaults to today).",
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
      .select("calories, protein_g, carbs_g, fat_g")
      .eq("user_id", ctx.getUserId()!)
      .gte("logged_at", startIso)
      .lt("logged_at", endIso);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    const round = (n: number) => Math.round(n * 10) / 10;
    const totals = {
      date: day,
      entries: rows.length,
      calories: Math.round(rows.reduce((s, r) => s + (r.calories ?? 0), 0)),
      protein_g: round(rows.reduce((s, r) => s + (r.protein_g ?? 0), 0)),
      carbs_g: round(rows.reduce((s, r) => s + (r.carbs_g ?? 0), 0)),
      fat_g: round(rows.reduce((s, r) => s + (r.fat_g ?? 0), 0)),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(totals, null, 2) }],
      structuredContent: totals,
    };
  },
});