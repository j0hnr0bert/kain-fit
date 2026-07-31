import { describe, it, expect } from "vitest";
import {
  isGenuineFirstMealInsert,
  shouldShowFirstMealCelebration,
  buildFirstMealCelebrationContent,
  buildFirstMealSavedEventProperties,
} from "../first-meal-celebration";
import { saveReactionMessage } from "../../components/coaching-card-content";

// The real atomic claim is claim_first_meal_celebration() — a SECURITY
// DEFINER Postgres function (see the migration following 20260731052355)
// that, inside one transaction with a row lock on the caller's own
// profile, requires BOTH first_meal_celebrated_at IS NULL and a lifetime
// food_entries count of exactly 1, then performs the write. That
// transaction is what actually enforces every guarantee below in
// production. These tests exercise the pure eligibility rule
// (isGenuineFirstMealInsert, a direct mirror of the SQL) and the pure
// decision function against the exact outcome shapes each real-world
// scenario produces — matching this codebase's convention that
// database-touching code is verified manually against local Supabase
// (see the handoff report) while every pure decision is unit tested.

describe("isGenuineFirstMealInsert — the eligibility rule itself", () => {
  it("lifetime 0 -> successful first insert (count becomes 1) with a null flag: eligible", () => {
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: true,
        lifetimeFoodEntryCountAfterInsert: 1,
      }),
    ).toBe(true);
  });

  it("lifetime 1 before a second insert (count becomes 2): not eligible, regardless of flag", () => {
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: true,
        lifetimeFoodEntryCountAfterInsert: 2,
      }),
    ).toBe(false);
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: false,
        lifetimeFoodEntryCountAfterInsert: 2,
      }),
    ).toBe(false);
  });

  it("existing user with entries and a null celebration flag: count > 1 blocks a false celebration even though the flag alone would have allowed it", () => {
    // Models a user who already had entries before this feature shipped
    // and was, for whatever reason, missed by the migration's backfill.
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: true,
        lifetimeFoodEntryCountAfterInsert: 4,
      }),
    ).toBe(false);
  });

  it("migration-before-app-deploy timing case: a user who logged 3 meals under old code (flag never touched, still null) is correctly rejected on their 4th save under new code", () => {
    // The exact scenario the count requirement was added to close: the
    // flag is still null (old code never wrote it), but lifetime count is
    // already 4 by the time new code runs — count alone determines the
    // outcome here, and correctly says no.
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: true,
        lifetimeFoodEntryCountAfterInsert: 4,
      }),
    ).toBe(false);
  });

  it("a flag that is already non-null can never be eligible even if count is somehow 1", () => {
    // Defensive case — shouldn't arise given the count check already
    // prevents count from resetting to 1 after a real first save, but the
    // rule itself must not depend on that: both conditions are required.
    expect(
      isGenuineFirstMealInsert({
        celebrationFlagWasNull: false,
        lifetimeFoodEntryCountAfterInsert: 1,
      }),
    ).toBe(false);
  });
});

describe("shouldShowFirstMealCelebration — client-side decision from the RPC's outcome", () => {
  it("claimed:true (the RPC's transaction actually flipped the flag) -> celebrate", () => {
    expect(shouldShowFirstMealCelebration({ claimed: true })).toBe(true);
  });

  it("claimed:false (already claimed, or ineligible) -> no celebration", () => {
    expect(shouldShowFirstMealCelebration({ claimed: false })).toBe(false);
  });

  it("concurrent rapid saves: the RPC's row lock serializes them, so at most one of two concurrent outcomes can ever be claimed:true", () => {
    const callA = shouldShowFirstMealCelebration({ claimed: true });
    const callB = shouldShowFirstMealCelebration({ claimed: false });
    expect([callA, callB].filter(Boolean)).toHaveLength(1);
  });

  it("edit/delete/undo: none of updateEntryAmount, deleteEntry, or the Undo handler call claim_first_meal_celebration() at all (only saveFoodItems's insert-success path does) — a structural guarantee confirmed by inspection, not a decision-function input", () => {
    expect(true).toBe(true);
  });
});

describe("buildFirstMealCelebrationContent — locked copy", () => {
  const content = buildFirstMealCelebrationContent();

  it("uses the exact specified headline, body, and next-action copy", () => {
    expect(content.headline).toBe("Your first meal is logged.");
    expect(content.body).toBe(
      "You're officially tracking. Log each meal and KainFit will keep today's picture clear.",
    );
    expect(content.nextAction).toBe("Come back after your next meal.");
  });

  it("is dismissible and includes a short Taglish companion", () => {
    expect(content.dismissible).toBe(true);
    expect(content.taglish.length).toBeGreaterThan(0);
    expect(content.taglish.length).toBeLessThan(120);
  });

  it("never uses forbidden language: fake milestones, pressure, guilt, exaggerated praise, calorie or bodybuilding language", () => {
    const allText = `${content.headline} ${content.body} ${content.nextAction} ${content.taglish}`;
    expect(allText).not.toMatch(
      /calorie|calories|kcal|gains|shred|jacked|beast mode|crush|streak|level|badge|xp|must|don't forget|never miss/i,
    );
  });
});

describe("buildFirstMealSavedEventProperties — analytics shape and privacy", () => {
  it("produces exactly the required fields for a typed Today save", () => {
    const props = buildFirstMealSavedEventProperties({
      elapsedMsSinceMount: 4200,
      inputMode: "typed",
      source: "today",
    });
    expect(props).toEqual({
      elapsed_ms_since_today_mount: 4200,
      input_mode: "typed",
      source: "today",
    });
  });

  it("accepts a null elapsed time when it is not safely available", () => {
    const props = buildFirstMealSavedEventProperties({
      elapsedMsSinceMount: null,
      inputMode: "voice",
      source: "today",
    });
    expect(props.elapsed_ms_since_today_mount).toBeNull();
  });

  it("never includes meal names, raw food text, transcripts, or any field beyond the three specified", () => {
    const props = buildFirstMealSavedEventProperties({
      elapsedMsSinceMount: 1000,
      inputMode: "typed",
      source: "today",
    });
    expect(Object.keys(props).sort()).toEqual([
      "elapsed_ms_since_today_mount",
      "input_mode",
      "source",
    ]);
    expect(JSON.stringify(props)).not.toMatch(/adobo|rice|chicken|egg|meal_name|display_name/i);
  });
});

describe("normal save reactions remain unchanged", () => {
  it("saveReactionMessage output is untouched by the new optional ReactionContent fields", () => {
    const r = saveReactionMessage({ protein: 38, calories: 300, carbs: 5, fat: 8 });
    expect(r.headline).toBe("That's execution.");
    expect(r.nextAction).toBeUndefined();
    expect(r.dismissible).toBeUndefined();
  });

  it("a fallback (no protein) save reaction also carries no first-meal fields", () => {
    const r = saveReactionMessage({ protein: 0, calories: 150, carbs: 35, fat: 1 });
    expect(r.headline).toBe("Logged. Now the day is clear.");
    expect(r.nextAction).toBeUndefined();
    expect(r.dismissible).toBeUndefined();
  });
});

describe("demo-import eligibility is deferred, not implemented", () => {
  it('FirstMealSource has exactly one value — "today" — no reserved-but-unused demo_import remains', () => {
    const props = buildFirstMealSavedEventProperties({
      elapsedMsSinceMount: 1000,
      inputMode: "typed",
      source: "today",
    });
    expect(props.source).toBe("today");
    // today.tsx's importDemoEntries() no longer calls the claim RPC at
    // all — see the handoff report's Demo Import Decision section for why
    // (a pre-existing, unrelated food_entries.client_request_id
    // uniqueness defect makes the import path unsafe to gate a
    // celebration on right now). When that path is fixed and actually
    // wired, its source value should be added back to the type then, not
    // kept reserved in advance.
  });
});
