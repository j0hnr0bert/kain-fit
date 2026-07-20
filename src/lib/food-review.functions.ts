// Founder review queue for user-submitted foods and proposed edits.
// Both flows are admin/founder-only; approvals invalidate the food-records cache
// so the resolver picks up changes on the next parse.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

async function ensureAdmin(ctx: { supabase: unknown; userId: string }): Promise<void> {
  const supa = ctx.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => {
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

type PendingSubmission = {
  id: string;
  product_name: string | null;
  brand: string | null;
  barcode: string | null;
  serving_size: string | null;
  extracted_values: JsonValue | null;
  review_status: string;
  created_at: string;
};

type PendingRevision = {
  id: string;
  food_record_id: string;
  previous_values: JsonValue | null;
  proposed_values: JsonValue | null;
  change_reason: string | null;
  review_status: string;
  created_at: string;
  food_display_name: string | null;
};

export const listFoodReviewQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (a: string, b: string[]) => {
            order: (
              a: string,
              opts: { ascending: boolean },
            ) => {
              limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
            };
          };
        };
      };
    };

    const [subsRes, revsRes] = await Promise.all([
      admin
        .from("food_submissions")
        .select(
          "id,product_name,brand,barcode,serving_size,extracted_values,review_status,created_at",
        )
        .in("review_status", ["unverified", "pending"])
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("food_revisions")
        .select(
          "id,food_record_id,previous_values,proposed_values,change_reason,review_status,created_at",
        )
        .in("review_status", ["unverified", "pending"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const submissions = (subsRes.data ?? []) as PendingSubmission[];
    const revisions = ((revsRes.data ?? []) as Omit<PendingRevision, "food_display_name">[]).map(
      (r) => ({ ...r, food_display_name: null as string | null }),
    );

    // Enrich revisions with the target food_records display name.
    if (revisions.length > 0) {
      const ids = Array.from(new Set(revisions.map((r) => r.food_record_id)));
      const rowsRes = await (
        admin as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
            };
          };
        }
      )
        .from("food_records")
        .select("id,display_name")
        .in("id", ids);
      const nameById = new Map<string, string>();
      for (const row of (rowsRes.data ?? []) as { id: string; display_name: string }[]) {
        nameById.set(row.id, row.display_name);
      }
      for (const r of revisions) {
        r.food_display_name = nameById.get(r.food_record_id) ?? null;
      }
    }

    return { submissions, revisions };
  });

const decideSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

export const reviewFoodSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (a: string, b: string) => Promise<{ error: unknown }>;
        };
      };
    };
    const nextStatus = data.action === "approve" ? "verified" : "rejected";
    const upd = await admin
      .from("food_submissions")
      .update({ review_status: nextStatus })
      .eq("id", data.id);
    if (upd.error) throw new Error("Failed to update submission");

    await logAudit(`food_submission:${data.action}`, data.id, context.userId);
    return { ok: true, status: nextStatus };
  });

// Whitelist of numeric columns a revision may overwrite on the target record.
const REVISION_ALLOWED_FIELDS = [
  "default_serving_grams",
  "calories_per_100g",
  "protein_per_100g",
  "carbs_per_100g",
  "fat_per_100g",
  "fiber_per_100g",
  "sugar_per_100g",
  "sodium_mg_per_100g",
  "edible_portion",
] as const;

export const reviewFoodRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: string) => {
            maybeSingle: () => Promise<{
              data: { food_record_id: string; proposed_values: JsonValue | null } | null;
              error: unknown;
            }>;
          };
        };
        update: (row: Record<string, unknown>) => {
          eq: (a: string, b: string) => Promise<{ error: unknown }>;
        };
      };
    };

    const nextStatus = data.action === "approve" ? "verified" : "rejected";

    if (data.action === "approve") {
      const rev = await admin
        .from("food_revisions")
        .select("food_record_id,proposed_values")
        .eq("id", data.id)
        .maybeSingle();
      if (rev.error || !rev.data) throw new Error("Revision not found");

      const proposed = rev.data.proposed_values ?? {};
      const patch: Record<string, unknown> = {};
      for (const key of REVISION_ALLOWED_FIELDS) {
        const v = (proposed as Record<string, JsonValue>)[key];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) patch[key] = v;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        const applied = await admin
          .from("food_records")
          .update(patch)
          .eq("id", rev.data.food_record_id);
        if (applied.error) throw new Error("Failed to apply revision");
        // Bust the resolver's in-memory catalog cache so the change is live.
        const { invalidateFoodRecordsCache } = await import("./food-records.server");
        invalidateFoodRecordsCache();
      }
    }

    const upd = await admin
      .from("food_revisions")
      .update({ review_status: nextStatus, reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (upd.error) throw new Error("Failed to update revision");

    await logAudit(`food_revision:${data.action}`, data.id, context.userId);
    return { ok: true, status: nextStatus };
  });

async function logAudit(key: string, targetId: string, actorId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> };
    };
    await admin.from("ops_audit_log").insert({
      actor_id: actorId,
      key,
      old_value: null,
      new_value: targetId,
    });
  } catch (err) {
    console.error("[food-review] audit insert failed", key, err);
  }
}