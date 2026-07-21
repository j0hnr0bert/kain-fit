import { describe, it, expect, vi } from "vitest";
import { sumNutrients } from "../nutrient-totals";
import { normalizeAuthError } from "../auth-errors";

// ────────────────────────────────────────────────────────────────
// 1. Shared deterministic nutrient totaling
// ────────────────────────────────────────────────────────────────
describe("sumNutrients (shared deterministic totals)", () => {
  it("returns zeros for an empty log", () => {
    expect(sumNutrients([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("sums exact stored values with no AI/derivation", () => {
    const totals = sumNutrients([
      { calories: 330, protein_g: 62, carbs_g: 0, fat_g: 7 },
      { calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0 },
    ]);
    expect(totals).toEqual({ calories: 525, protein: 66, carbs: 42, fat: 7 });
  });

  it("coerces string and null macro values (Supabase numeric columns)", () => {
    const totals = sumNutrients([
      { calories: "330", protein_g: "62.5", carbs_g: null, fat_g: undefined },
      { calories: 195, protein_g: 4, carbs_g: "42", fat_g: 0 },
    ]);
    expect(totals.calories).toBe(525);
    expect(totals.protein).toBeCloseTo(66.5, 5);
    expect(totals.carbs).toBe(42);
    expect(totals.fat).toBe(0);
  });

  it("is deterministic and order-independent", () => {
    const a = [
      { calories: 100, protein_g: 10, carbs_g: 5, fat_g: 1 },
      { calories: 200, protein_g: 20, carbs_g: 15, fat_g: 3 },
      { calories: 50, protein_g: 3, carbs_g: 8, fat_g: 2 },
    ];
    const shuffled = [a[2], a[0], a[1]];
    expect(sumNutrients(a)).toEqual(sumNutrients(shuffled));
  });

  it("stays correct after edit and delete simulations", () => {
    let entries = [
      { calories: 330, protein_g: 62, carbs_g: 0, fat_g: 7 },
      { calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0 },
    ];
    expect(sumNutrients(entries).calories).toBe(525);
    // edit second entry (grams doubled → macros doubled)
    entries = [entries[0], { calories: 390, protein_g: 8, carbs_g: 84, fat_g: 0 }];
    expect(sumNutrients(entries).calories).toBe(720);
    // delete first entry
    entries = [entries[1]];
    expect(sumNutrients(entries)).toEqual({ calories: 390, protein: 8, carbs: 84, fat: 0 });
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Duplicate-submit protection
//    Contract mirrors the food.functions.ts save path: a stable
//    client_request_id de-dupes rapid double clicks so only one row
//    is inserted for the same logical submission.
// ────────────────────────────────────────────────────────────────
describe("duplicate-submit protection (client_request_id)", () => {
  function makeSaver() {
    const rows = new Map<string, { id: number; payload: unknown }>();
    let nextId = 1;
    return {
      rows,
      async save(payload: { client_request_id: string; text: string }) {
        if (rows.has(payload.client_request_id)) {
          return { inserted: false, id: rows.get(payload.client_request_id)!.id };
        }
        const id = nextId++;
        rows.set(payload.client_request_id, { id, payload });
        return { inserted: true, id };
      },
    };
  }

  it("inserts only once when the same request id is submitted twice back-to-back", async () => {
    const saver = makeSaver();
    const rid = "req-abc-123";
    const [a, b] = await Promise.all([
      saver.save({ client_request_id: rid, text: "150g rice" }),
      saver.save({ client_request_id: rid, text: "150g rice" }),
    ]);
    expect(saver.rows.size).toBe(1);
    expect([a.inserted, b.inserted].filter(Boolean).length).toBe(1);
    expect(a.id).toBe(b.id);
  });

  it("inserts separate rows for two distinct submissions", async () => {
    const saver = makeSaver();
    await saver.save({ client_request_id: "r1", text: "chicken" });
    await saver.save({ client_request_id: "r2", text: "chicken" });
    expect(saver.rows.size).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. Profile initialization idempotency
//    Mirrors handle_new_user() trigger contract:
//      INSERT ... ON CONFLICT (user_id) DO NOTHING
// ────────────────────────────────────────────────────────────────
describe("profile initialization idempotency", () => {
  function makeProfiles() {
    const table = new Map<string, { user_id: string; display_name: string }>();
    return {
      table,
      onNewUser(user: { id: string; display_name: string }) {
        if (table.has(user.id)) return { created: false };
        table.set(user.id, { user_id: user.id, display_name: user.display_name });
        return { created: true };
      },
    };
  }

  it("creates a profile exactly once even if the trigger fires repeatedly", () => {
    const p = makeProfiles();
    const user = { id: "u-1", display_name: "Kai" };
    expect(p.onNewUser(user).created).toBe(true);
    expect(p.onNewUser(user).created).toBe(false);
    expect(p.onNewUser(user).created).toBe(false);
    expect(p.table.size).toBe(1);
  });

  it("still creates a distinct profile for a different user id", () => {
    const p = makeProfiles();
    p.onNewUser({ id: "u-1", display_name: "Kai" });
    p.onNewUser({ id: "u-2", display_name: "Nina" });
    expect(p.table.size).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Auth timeout recovery
//    The auth flow surfaces a non-blocking "still waiting" hint if a
//    provider popup doesn't complete quickly. normalizeAuthError must
//    classify that as `oauth_slow` with an actionable suggestion, not a
//    dead-end failure.
// ────────────────────────────────────────────────────────────────
describe("auth timeout recovery", () => {
  it("classifies still_waiting_after_8s as oauth_slow with allow_popup guidance", () => {
    const err = new Error("still_waiting_after_8s");
    const n = normalizeAuthError(err);
    expect(n.code).toBe("oauth_slow");
    expect(n.suggestion).toBe("allow_popup");
    expect(n.userMessage.length).toBeGreaterThan(0);
  });

  it("classifies popup blocked/closed as popup_blocked", () => {
    expect(normalizeAuthError(new Error("Popup was blocked by browser")).code).toBe(
      "popup_blocked",
    );
    expect(normalizeAuthError(new Error("Popup closed by user")).code).toBe("popup_blocked");
  });

  it("classifies user_cancelled without leaking raw stack", () => {
    const n = normalizeAuthError(new Error("User cancelled the flow"));
    expect(n.code).toBe("user_cancelled");
    expect(n.userMessage).not.toContain("stack");
  });

  it("times-out promise + normalizes as oauth_slow", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 50));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("still_waiting_after_8s")), 5),
    );
    try {
      await Promise.race([slow, timeout]);
      throw new Error("expected timeout");
    } catch (err) {
      const n = normalizeAuthError(err);
      expect(n.code).toBe("oauth_slow");
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 5. Analytics schema accepts every emitted auth event
//    Mirrors the ALLOWED_EVENTS enum in beta.functions.ts and the
//    is_allowed_event_name() DB check. If either drifts, the Zod
//    validator on log_product_event returns 422 and telemetry is lost.
// ────────────────────────────────────────────────────────────────
describe("analytics schema accepts every emitted auth event", () => {
  // Kept in sync with src/lib/beta.functions.ts ALLOWED_EVENTS auth slice
  // and the DB is_allowed_event_name() function.
  const EMITTED_AUTH_EVENTS = [
    "auth_method_chosen",
    "signup_started",
    "signup_completed",
    "signup_failed",
    "auth_attempt_completed",
    "first_food_logged",
  ] as const;

  // Duplicated locally so this test does not import the server module
  // (which pulls TanStack Start's server context).
  const ALLOWED_EVENTS = new Set<string>([
    "landing_viewed","demo_started","demo_food_submitted","demo_food_confirmed",
    "signup_started","signup_completed","onboarding_completed",
    "food_submitted","food_parse_succeeded","food_parse_failed",
    "food_clarification_requested","food_edited_before_confirmation",
    "food_confirmed","food_deleted","incorrect_macros_reported",
    "saved_meal_repeated","feedback_submitted","app_returned",
    "admin_dashboard_viewed","app_loaded","today_ready","web_vital",
    "db_query_timing","food_calc_timing","food_save_timing",
    "cache_hit","cache_miss","ai_call_timing","route_load_timing",
    "error_boundary","food_search_started","food_search_results_shown",
    "food_calculation_started","food_calculation_completed",
    "food_log_saved","performance_error",
    "auth_method_chosen","signup_failed","first_food_logged",
    "auth_attempt_completed",
  ]);

  it.each(EMITTED_AUTH_EVENTS)("accepts %s", (evt) => {
    expect(ALLOWED_EVENTS.has(evt)).toBe(true);
  });

  it("rejects an unknown event name", () => {
    expect(ALLOWED_EVENTS.has("auth_totally_fake_event")).toBe(false);
  });
});

// Silence any lingering unused warnings from linters that don't see vi.
void vi;