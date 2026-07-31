import { auth, defineMcp } from "@lovable.dev/mcp-js";
import logFood from "./tools/log-food";
import listFoodEntries from "./tools/list-food-entries";
import dailyTotals from "./tools/daily-totals";
import searchFoodDatabase from "./tools/search-food-database";

// The OAuth issuer must be the direct Supabase host; the project ref is the
// only value that survives publish unchanged.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "kain-track",
  title: "Kain Track",
  version: "0.1.0",
  instructions:
    "Tools for KainFit, a Filipino-first macro tracker. Use `search_food_database` to find verified per-100g nutrition, scale it to the amount eaten, then `log_food` to save it. Use `list_food_entries` and `daily_totals` to review a day. Days follow the Manila (UTC+8) calendar. Always ask whether rice, pasta and meat weights are raw or cooked before logging.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchFoodDatabase, logFood, listFoodEntries, dailyTotals],
});