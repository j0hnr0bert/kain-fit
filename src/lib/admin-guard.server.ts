// Shared admin/founder authorization check for privileged server functions.
// Runs the query through the caller's own RLS-scoped client (ctx.supabase
// from requireSupabaseAuth), so a non-admin can only ever see their own
// user_roles row — this check cannot be spoofed by the caller.
export async function ensureAdmin(ctx: { supabase: unknown; userId: string }): Promise<void> {
  const supa = ctx.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          a: string,
          b: string,
        ) => {
          in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data } = await supa
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .in("role", ["admin", "founder"]);
  if (!data || data.length === 0) throw new Error("Forbidden");
}
