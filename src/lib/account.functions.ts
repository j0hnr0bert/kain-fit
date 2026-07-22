import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Permanently deletes the caller's own auth.users row. Every user-owned
// table (profiles, food_entries, saved_foods, saved_meals, user_roles,
// macro_reports) cascade-deletes via its auth.users FK; analytics-adjacent
// tables (product_events, feedback_submissions, food_revisions,
// food_submissions) anonymize the row via ON DELETE SET NULL instead of
// losing the aggregate data. See supabase/migrations for the FK definitions.
export const deleteOwnAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) {
      console.error("[account] deleteOwnAccount failed", error);
      throw new Error("Could not delete your account. Please try again or contact support.");
    }
    return { success: true as const };
  });
