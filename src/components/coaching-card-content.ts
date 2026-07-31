// Pure content/theme logic for CoachingCard — kept out of the component
// file so it stays unit-testable (react-refresh/only-export-components
// warns on a component file that also exports non-component values) and so
// wording/theming stay separate from rendering, matching coaching.ts's own
// separation of decision logic from voice.
//
// Voice lock (2026-07-24): KainFit has one coaching voice — high
// expectations, honest feedback, decisive action, earned recognition. No
// "Hard Mode," no softer alternative, no style selector. The governing
// rule: CHALLENGE THE BEHAVIOR, NEVER ATTACK THE PERSON. See the product
// spec this file implements for the full doctrine (REALITY -> STANDARD ->
// GAP -> ACTION -> RECOGNITION) and the locked copy matrix it's built from.

import { Check, Compass, Sparkles, Sunrise, TrendingUp, Zap } from "lucide-react";
import type { CoachingResult } from "@/lib/coaching";

export type CoachingTone = "recover" | "guide" | "celebrate" | "reinforce";

export type Content = {
  icon: typeof Compass;
  tone: CoachingTone;
  /** Short, bold, decisive — the reality or the standard, never both. */
  headline: string;
  /** The gap and/or the one useful next action. May end with a tie-down
   * question as its final sentence when (and only when) this specific copy
   * was authored with one — see the tie-down eligibility rules below. Never
   * append a tie-down to this at render time; it is either already part of
   * the authored sentence or absent. */
  body: string;
  taglish: string;
};

export type Theme = {
  bg: string;
  border: string;
  icon: string;
  iconWrap: string;
  /** Extra class for states that need more than bg/border — currently
   * only Celebrate's static glow (see styles.css .celebrate-glow). */
  extra?: string;
};

// Every state gets its own restrained identity, sharing one layout. Guide
// stays teal (the everyday, highest-frequency state); Celebrate is the only
// state allowed a stronger accent and a static glow, since it's the one
// moment meant to feel earned; Reinforce is a distinct but equally quiet
// blue-teal; Recovery is warm, never red/orange/anything warning-adjacent —
// the app confronts the gap, never the person, and Recovery is where that
// distinction matters most.
const TONE_THEME: Record<CoachingTone, Theme> = {
  guide: {
    bg: "bg-primary/8",
    border: "border-primary/22",
    icon: "text-primary",
    iconWrap: "bg-primary/16",
  },
  // Its own token, not --accent — see styles.css: --accent's value is
  // tuned as a filled-badge background, not a standalone foreground/icon
  // color (measured ~2.2:1 contrast there), so --celebrate is a small
  // dedicated token instead.
  celebrate: {
    bg: "bg-celebrate/16",
    border: "border-celebrate/45",
    icon: "text-celebrate",
    iconWrap: "bg-celebrate/26",
    extra: "celebrate-glow",
  },
  reinforce: {
    bg: "bg-reinforce/12",
    border: "border-reinforce/32",
    icon: "text-reinforce",
    iconWrap: "bg-reinforce/20",
  },
  recover: {
    bg: "bg-amber-brand/13",
    border: "border-amber-brand/30",
    icon: "text-foreground/85",
    iconWrap: "bg-amber-brand/22",
  },
};

export function themeForTone(tone: CoachingTone): Theme {
  return TONE_THEME[tone];
}

/**
 * Promise-language eligibility. "Promise kept" / "you committed to" /
 * "you chose" language may only appear when the underlying target was
 * explicitly entered and confirmed by the user — never for an
 * auto-generated or inferred default. Today's data model has exactly one
 * signal for this: profiles.manual_targets_enabled, set true only when the
 * user submits their own numbers via the profile targets form (see
 * profile.tsx's saveTargets/toggleTargets). This function exists as an
 * explicit gate, not an informal copywriting convention, specifically so
 * it can be tested in isolation from messageFor's larger switch.
 */
export function isPromiseEligible(manualTargetsEnabled: boolean): boolean {
  return manualTargetsEnabled === true;
}

export function messageFor(
  result: CoachingResult,
  proteinRemaining: number,
  weekly: { thisWeekDays: number; lastWeekDays: number },
  promiseEligible: boolean,
): Content | null {
  switch (result.kind) {
    case "recover":
      return recoverMessage();
    case "guide":
      return guideMessage(result.reason, proteinRemaining);
    case "celebrate":
      return promiseEligible ? celebrateMessagePromise() : celebrateMessageHandled();
    case "reinforce":
      return reinforceMessage(weekly);
    case "silence":
      return null;
  }
}

// No tie-down: Recovery can persist across many renders during the same
// return session (it is not gated on hasLoggedToday — see coaching.ts),
// so the default copy stays tie-down-free to avoid the same question
// showing on every rerender. See recoveryTieDownVariant below for the
// approved alternate, demonstrated in the QA harness only.
function recoverMessage(): Content {
  return {
    icon: Sunrise,
    tone: "recover",
    headline: "You're back. Good.",
    body: "Log the next meal and rebuild momentum.",
    taglish: "Bumalik ka. Good. I-log ang susunod na meal at ibalik ang momentum.",
  };
}

function guideMessage(
  reason: "first-meal" | "protein-remaining" | "calories-near",
  proteinRemaining: number,
): Content {
  if (reason === "first-meal") {
    // The only Guide reason safe for a default tie-down: it fires at most
    // once per day (hasLoggedToday flips true the moment any meal is
    // logged, and never flips back), so "shown repeatedly in one day" is
    // structurally impossible here.
    return {
      icon: Compass,
      tone: "guide",
      headline: "Start with the truth.",
      body: "Log your first meal and see where you stand. One honest log starts the day—simple enough, right?",
      taglish: "Simulan sa totoong data. I-log ang unang kinain mo at tingnan kung nasaan ka.",
    };
  }
  if (reason === "protein-remaining") {
    // Copy fix (2026-07-24): "Protein is behind pace" claimed a time-of-day
    // pacing judgment KainFit does not have — evaluateCoaching's
    // protein-remaining branch fires purely on proteinRemaining > 0, with
    // no clock, wake/sleep schedule, meal-count expectation, or
    // distribution model behind it (see coaching.ts). A remaining
    // quantity is real; "behind pace" is not something this app can
    // truthfully claim yet. Clamped defensively even though the caller
    // (today.tsx) already clamps to >=0 — this function must never render
    // "-10g" regardless of what it's handed.
    // No tie-down by default — this can legitimately re-fire after every
    // meal until protein is met. See proteinRemainingTieDownVariant.
    const g = Math.max(0, Math.round(proteinRemaining));
    return {
      icon: Compass,
      tone: "guide",
      headline: "Protein is the priority.",
      body: `You have ${g}g remaining. Build your next meal around it.`,
      // Density pass (2026-07-25): says the same thing as the English
      // without mechanically repeating it — "ka" and the second "ang
      // protein" were redundant once the headline already establishes the
      // subject, and the card only has room for one short companion line.
      taglish: `Kulang pa ng ${g}g protein. Unahin sa susunod na meal.`,
    };
  }
  // calories-near — also no tie-down by default, same repetition risk.
  return {
    icon: Compass,
    tone: "guide",
    headline: "Your margin is getting smaller.",
    body: "Keep the next meal lean and protein-focused.",
    taglish: "Panatilihing magaan at mataas sa protina ang susunod na kainin.",
  };
}

function celebrateMessagePromise(): Content {
  return {
    icon: Check,
    tone: "celebrate",
    headline: "Promise kept.",
    body: "You hit the targets you set for yourself today.",
    taglish: "Tinupad mo ang pangako mo sa sarili mo ngayong araw.",
  };
}

function celebrateMessageHandled(): Content {
  return {
    icon: Check,
    tone: "celebrate",
    headline: "Targets handled.",
    body: "You followed through today.",
    taglish: "Natapos mo ang targets mo ngayong araw.",
  };
}

// No tie-down by default — future pacing is the approved intensifier here
// instead (see the product spec's section 3: Reinforce is one of the
// explicit future-pacing trigger points). Fires at most once per day in
// practice (nothing about weekly counts changes intraday once computed).
function reinforceMessage(weekly: { thisWeekDays: number; lastWeekDays: number }): Content {
  const days = weekly.thisWeekDays === 1 ? "day" : "days";
  return {
    icon: TrendingUp,
    tone: "reinforce",
    headline: `${weekly.thisWeekDays} disciplined ${days}—up from ${weekly.lastWeekDays}.`,
    body: "Your actions are starting to match your goal. Keep this standard and Day 90 will have real evidence behind it.",
    taglish: "Mas consistent ka ngayong linggo. Nagiging katotohanan ang sinasabi mong goal mo.",
  };
}

// ---- Tie-down alternates ----
//
// Approved phrasing for states that CAN fire more than once in a single
// day (protein-remaining, calories-near, recover). Wiring these into the
// live default would risk showing the same tie-down question repeatedly,
// which the product spec explicitly prohibits; safely rotating or gating
// them ("shown once per day") needs new day-keyed state, out of scope for
// this pass (see the final report's recommended follow-up). These exist so
// the phrasing is written, reviewed, and tested now — demonstrated in the
// QA harness's "natural tie-down usage" panel — without shipping the
// repetition risk today.

export function proteinRemainingTieDownVariant(proteinRemaining: number): Content {
  const g = Math.max(0, Math.round(proteinRemaining));
  return {
    icon: Compass,
    tone: "guide",
    headline: "Protein is the priority.",
    body: `You have ${g}g remaining. Protein muna sa next meal. Clear?`,
    taglish: `Kulang ka pa ng ${g}g protein. Unahin ang protein sa susunod na meal.`,
  };
}

export function calorieMarginTieDownVariant(caloriesRemaining: number): Content {
  const c = Math.round(caloriesRemaining);
  return {
    icon: Compass,
    tone: "guide",
    headline: "Your margin is getting smaller.",
    body: `${c} calories remain. Lean protein is the move now. Have you got that?`,
    taglish: `${c} kalorya na lang ang natitira. Lean protein ang susunod. Gets?`,
  };
}

export function recoveryTieDownVariant(): Content {
  return {
    icon: Sunrise,
    tone: "recover",
    headline: "You're back. Good.",
    body: "Do not reconstruct the missing days. Start with the next meal. Are you with me?",
    taglish:
      "Bumalik ka. Good. Huwag nang balikan ang mga nakalipas na araw—simulan sa susunod na meal. Kasama kita?",
  };
}

/**
 * A deliberately unnatural tie-down, kept here as a documented rejected
 * example (not used anywhere in production) — the tie-down has no logical
 * object, since "great protein" is a completed observation, not an
 * instruction. See coaching-card-content.test.ts's rejected-example test
 * and the QA harness's "deliberately rejected tie-down" panel. Do not
 * reuse this construction.
 */
export const REJECTED_TIE_DOWN_EXAMPLE = "Great protein. Are you with me?";

// ---- Designed but not wired ----
//
// These three states are written and tested against the locked copy
// direction, but evaluateCoaching() has no leaf that reaches them —
// adding one would change the locked 2026-07-23 hierarchy (Recovery >
// Guide > Celebrate > Reinforce > Silence) or the CoachingInput signals it
// runs on, which this pass is not authorized to do silently. See the
// final report's "hierarchy conflicts" section for what each would
// require. Exported only so the QA harness can render them as clearly
// labeled static mockups and so the copy itself is reviewable now.

/** Requires distinguishing "exceeded" from "exactly met" — coaching.ts's
 * caloriesRemaining is pre-clamped to >=0 before it reaches evaluateCoaching,
 * so today there is no signal that separates this from steady-state
 * Celebrate/Guide. Needs a new unclamped-overage input. */
export function aboveCalorieTargetMessage(): Content {
  return {
    icon: Check,
    tone: "guide",
    headline: "You're above today's calorie target.",
    body: "The data is recorded. Tomorrow starts clean. An honest high day is more useful than a hidden one.",
    taglish:
      "Lumampas ka sa calorie target ngayon. Naitala ang totoong datos. Malinis ang simula bukas.",
  };
}

/** Requires a new "declined vs improved" branch in evaluateCoaching — today
 * a non-improved week (thisWeekDays <= lastWeekDays) falls through to
 * Silence, not a dedicated message, and this pass is not authorized to
 * change that ranking silently. */
export function weeklyDeclineMessage(weekly: {
  thisWeekDays: number;
  lastWeekDays: number;
}): Content {
  return {
    icon: TrendingUp,
    tone: "reinforce",
    headline: "The standard slipped.",
    body: `${weekly.thisWeekDays} logging ${weekly.thisWeekDays === 1 ? "day" : "days"} this week. Last week was ${weekly.lastWeekDays}. Reclaim it with your next meal.`,
    taglish: "Bumaba ang consistency mo this week. Ibalik ito sa susunod na meal mo.",
  };
}

/** Requires fetching and evaluating a PAST day's completion state —
 * evaluateCoaching only ever looks at today; this needs a new query and a
 * new day-boundary check that does not exist yet. */
export function missedDailyTargetMessage(): Content {
  return {
    icon: Compass,
    tone: "guide",
    headline: "The target wasn't met today.",
    body: "Own the data. Tomorrow starts with the first honest log.",
    taglish:
      "Hindi natapos ang target ngayon. Tanggapin ang datos — bukas, simulan ulit nang tapat.",
  };
}

// ---- Save-reaction system ("the doggy-biscuit moment") ----
//
// A short-lived acknowledgment shown immediately after a successful save,
// before the standing coaching hierarchy's own message (messageFor above,
// completely unchanged) takes back over. This is deliberately a separate,
// additive layer — it never changes what evaluateCoaching() decides, only
// what's shown for a few seconds right after a save completes. Every
// successful save gets one, including a save that doesn't move any target
// forward — honest logging is the behavior being reinforced, not "good"
// eating (see the module-level rule: never withhold this for an
// imperfect meal, never moralize food).

export type SaveDelta = { protein: number; calories: number; carbs: number; fat: number };

export type SaveReactionContext = {
  /** Protein remaining after this save, when targets are active — lets
   * the reaction cite the actual gap instead of a generic line. */
  proteinRemainingAfter?: number;
  /** True when this save happened while Recovery's gap condition was
   * active (gapDays >= 3) — surfaces "Back in motion" instead of the
   * ordinary acknowledgment for the user's first log after an absence. */
  wasRecovering?: boolean;
};

export type ReactionQuality = "standard" | "strong";

export type ReactionContent = {
  icon: typeof Sparkles;
  quality: ReactionQuality;
  headline: string;
  body: string;
  taglish: string;
  /** Optional fourth line. Only the first-meal celebration sets this today
   * (see first-meal-celebration.ts) — ordinary save reactions omit it and
   * render exactly as before. */
  nextAction?: string;
  /** Shows an explicit close control when true. Ordinary save reactions
   * already auto-dismiss quickly and omit this; the first-meal celebration
   * sets it so the user isn't forced to wait even its own short timer out. */
  dismissible?: boolean;
};

export const REACTION_THEME: Record<ReactionQuality, Theme> = {
  standard: {
    bg: "bg-primary/10",
    border: "border-primary/28",
    icon: "text-primary",
    iconWrap: "bg-primary/20",
  },
  // The hero-metric ring color, not a coaching-hierarchy token — reserved
  // for the moment a meal was specifically protein-dense, so it reads as
  // "notably good," distinct from an ordinary logged meal.
  strong: {
    bg: "bg-ring-protein/14",
    border: "border-ring-protein/38",
    icon: "text-ring-protein",
    iconWrap: "bg-ring-protein/24",
  },
};

/**
 * A meal is "protein-dense" when a meaningful share of its calories came
 * from protein and the absolute amount is non-trivial — both conditions
 * guard against a tiny snack with a coincidentally high protein ratio
 * reading as a "strong hit."
 */
function isProteinDense(delta: SaveDelta): boolean {
  if (delta.calories <= 0 || delta.protein < 15) return false;
  const proteinCalorieShare = (delta.protein * 4) / delta.calories;
  return proteinCalorieShare >= 0.35;
}

export function saveReactionMessage(
  delta: SaveDelta,
  ctx: SaveReactionContext = {},
): ReactionContent {
  if (ctx.wasRecovering) {
    return {
      icon: Sparkles,
      quality: "standard",
      headline: "Back in motion.",
      body: "One honest entry restarted the process.",
      taglish: "Balik-andar na. Isang tapat na log, sapat na para makapagsimula ulit.",
    };
  }
  if (isProteinDense(delta)) {
    return {
      icon: Zap,
      quality: "strong",
      headline: "That's execution.",
      body: `${Math.round(delta.protein)}g protein added. You moved significantly closer.`,
      taglish: "Malakas na protein dito — solid. Papalapit ka na nang malaki.",
    };
  }
  if (delta.protein >= 1) {
    const body =
      ctx.proteinRemainingAfter != null
        ? `${Math.round(delta.protein)}g protein added. You have ${Math.round(ctx.proteinRemainingAfter)}g remaining.`
        : `${Math.round(delta.protein)}g protein added.`;
    return {
      icon: Sparkles,
      quality: "standard",
      headline: "Logged. Now the day is clear.",
      body,
      taglish: `Dagdag ${Math.round(delta.protein)}g protein — malinaw na ang laban ngayon.`,
    };
  }
  return {
    icon: Sparkles,
    quality: "standard",
    headline: "Logged. Now the day is clear.",
    body: "Your numbers are updated. Keep moving.",
    taglish: "Naka-log na. Updated ang numbers mo — ituloy lang.",
  };
}
