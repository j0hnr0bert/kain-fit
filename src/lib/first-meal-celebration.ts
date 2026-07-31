// First-meal celebration — pure decision, content, and analytics-shaping
// logic for the one-time acknowledgment shown the first time a user ever
// saves a real meal.
//
// The actual eligibility *claim* is a database operation: the
// claim_first_meal_celebration() RPC (see the migration that follows
// 20260731052355), called with no arguments from today.tsx. It requires,
// atomically, inside one transaction with a row lock on the caller's own
// profile:
//   1. first_meal_celebrated_at IS NULL
//   2. the caller's lifetime food_entries count is exactly 1 (not
//      entries.length, which only reflects today; not localStorage, which
//      is per-device and not authoritative)
// The lifetime-count requirement is what protects against the gap between
// a migration applying to production and the application code that calls
// this RPC being deployed — a user who accumulated more than one entry
// under old code during that gap would otherwise have a null flag but
// more than one entry, and a later save under new code would misread as
// "first ever" without the count check.
//
// This module only decides what to do with the RPC's boolean outcome, so
// the decision itself stays pure and unit-testable without mocking the
// Supabase client — matching this codebase's existing convention
// (kain-signal-*.ts, coaching.ts): database-touching code is verified
// manually against local Supabase; pure logic is unit tested.
//
// Demo-import eligibility is deferred, not implemented — deliberately not
// represented in FirstMealSource below. The demo→signup import path
// (today.tsx's importDemoEntries) has a pre-existing, unrelated defect —
// its upsert targets client_request_id without a matching unique
// constraint on food_entries — so it cannot be trusted to have durably
// inserted before a celebration claim would be attempted. Fixing that
// constraint is out of scope here; see the handoff report. When that path
// is fixed and actually wired to a claim, add its source value back then,
// not before — a reserved-but-unused value would describe behavior that
// cannot occur in production today.
//
// Analytics semantics: first_meal_saved is only ever tracked after the
// RPC returns claimed:true — database eligibility (the celebration state
// the user actually saw) is enforced at-most-once, server-side,
// regardless of network conditions. The track() call itself is
// fire-and-forget, like every other event in this codebase: delivery of
// the *event* is best-effort, not exactly-once. It is possible (though
// rare) for the celebration to correctly fire exactly once for a user
// while the corresponding analytics record is lost to a dropped request;
// it is not possible for the event to be sent for two different saves for
// the same user, since the RPC's atomicity guarantees at most one save
// ever observes claimed:true.

import { Sparkles } from "lucide-react";
import type { ReactionContent } from "@/components/coaching-card-content";

export type FirstMealSource = "today";
export type FirstMealInputMode = "typed" | "voice";

// Mirrors, in pure TypeScript, the exact rule enforced by
// claim_first_meal_celebration()'s SQL — not itself the enforcement (only
// the database transaction is authoritative under concurrency), but a
// direct, unit-testable statement of what that SQL is supposed to compute,
// so the eligibility rule itself has coverage independent of the RPC
// wiring.
export function isGenuineFirstMealInsert(input: {
  celebrationFlagWasNull: boolean;
  lifetimeFoodEntryCountAfterInsert: number;
}): boolean {
  return input.celebrationFlagWasNull && input.lifetimeFoodEntryCountAfterInsert === 1;
}

export type FirstMealClaimOutcome = {
  /** The raw boolean returned by claim_first_meal_celebration(). True only
   * when THIS call's transaction actually flipped
   * first_meal_celebrated_at from null to non-null for this user — the
   * function's row lock on the caller's own profile means at most one
   * concurrent call, ever, across every device and tab, can see
   * `claimed: true` for a given user. */
  claimed: boolean;
};

export function shouldShowFirstMealCelebration(outcome: FirstMealClaimOutcome): boolean {
  return outcome.claimed;
}

// No fake milestones, no pressure, no guilt, no exaggerated praise, no
// calorie language, no bodybuilding language — see the locked copy this
// was specified with.
export function buildFirstMealCelebrationContent(): ReactionContent {
  return {
    icon: Sparkles,
    quality: "standard",
    headline: "Your first meal is logged.",
    body: "You're officially tracking. Log each meal and KainFit will keep today's picture clear.",
    taglish: "Simula na. I-log lang ang bawat kain mo, malinaw agad ang araw mo.",
    nextAction: "Come back after your next meal.",
    dismissible: true,
  };
}

export type FirstMealSavedEventProperties = {
  elapsed_ms_since_today_mount: number | null;
  input_mode: FirstMealInputMode;
  source: FirstMealSource;
};

// Deliberately narrow: only a duration, an enum, and an enum. No meal
// names, no raw food text, no transcripts — see today.tsx's call site,
// which never passes anything else in.
export function buildFirstMealSavedEventProperties(input: {
  elapsedMsSinceMount: number | null;
  inputMode: FirstMealInputMode;
  source: FirstMealSource;
}): FirstMealSavedEventProperties {
  return {
    elapsed_ms_since_today_mount: input.elapsedMsSinceMount,
    input_mode: input.inputMode,
    source: input.source,
  };
}
