// Pure content/theme logic for CoachingCard — kept out of the component
// file so it stays unit-testable (react-refresh/only-export-components
// warns on a component file that also exports non-component values) and so
// wording/theming stay separate from rendering, matching coaching.ts's own
// separation of decision logic from voice.

import { CheckCircle2, Compass, RotateCcw, TrendingUp } from "lucide-react";
import type { CoachingResult } from "@/lib/coaching";

export type CoachingTone = "recover" | "guide" | "celebrate" | "reinforce";

export type Content = {
  icon: typeof Compass;
  tone: CoachingTone;
  line: string;
  taglish: string;
};

export type Theme = { bg: string; border: string; icon: string };

// Every state gets its own restrained identity, sharing one layout. Guide
// stays teal (the everyday, highest-frequency state); Celebrate is the only
// state allowed a stronger accent, since it's the one moment meant to stand
// out; Reinforce is a distinct but equally quiet blue-teal; Recovery is
// warm, never red/orange/anything warning-adjacent, per the explicit
// "never suggest failure" requirement for a returning user.
const TONE_THEME: Record<CoachingTone, Theme> = {
  guide: { bg: "bg-primary/5", border: "border-primary/15", icon: "text-primary" },
  // Its own token, not --accent — see styles.css: --accent's dark-mode
  // value is a muted surface color (~1.4:1 contrast as a foreground), not
  // a vivid accent, so --celebrate is a small dedicated token instead.
  celebrate: { bg: "bg-celebrate/10", border: "border-celebrate/30", icon: "text-celebrate" },
  reinforce: { bg: "bg-reinforce/8", border: "border-reinforce/25", icon: "text-reinforce" },
  recover: { bg: "bg-amber-brand/8", border: "border-amber-brand/20", icon: "text-foreground/80" },
};

export function themeForTone(tone: CoachingTone): Theme {
  return TONE_THEME[tone];
}

export function messageFor(
  result: CoachingResult,
  proteinRemaining: number,
  weekly: { thisWeekDays: number; lastWeekDays: number },
): Content | null {
  switch (result.kind) {
    case "recover":
      return recoverMessage(result.tier);
    case "guide":
      return guideMessage(result.reason, proteinRemaining);
    case "celebrate":
      return {
        icon: CheckCircle2,
        tone: "celebrate",
        line: "Targets hit for today.",
        taglish: "Tapos na ang laban ngayong araw — ang galing!",
      };
    case "reinforce":
      return {
        icon: TrendingUp,
        tone: "reinforce",
        line: `Logged ${weekly.thisWeekDays} ${weekly.thisWeekDays === 1 ? "day" : "days"} this week, up from ${weekly.lastWeekDays} last week.`,
        taglish: "Mas madalas ka nag-log ngayong linggo — steady progress.",
      };
    case "silence":
      return null;
  }
}

function recoverMessage(tier: "3-6" | "7-29" | "30+"): Content {
  const copy: Record<typeof tier, { line: string; taglish: string }> = {
    "3-6": { line: "Let's pick this back up.", taglish: "Simula ulit — isang meal lang muna." },
    "7-29": { line: "Good to have you back.", taglish: "Fresh start — log anything, kahit konti." },
    "30+": {
      line: "Welcome back — no pressure to catch up.",
      taglish: "Isang hakbang lang muna, okay na yan.",
    },
  };
  return { icon: RotateCcw, tone: "recover", ...copy[tier] };
}

function guideMessage(
  reason: "first-meal" | "protein-remaining" | "calories-near",
  proteinRemaining: number,
): Content {
  if (reason === "first-meal") {
    return {
      icon: Compass,
      tone: "guide",
      line: "Log your first meal to get today started.",
      taglish: "Simulan mo — i-type mo lang ang unang kinain mo.",
    };
  }
  if (reason === "protein-remaining") {
    return {
      icon: Compass,
      tone: "guide",
      line: `${Math.round(proteinRemaining)}g protein left today.`,
      taglish: "Konti na lang — kaya mo yan!",
    };
  }
  return {
    icon: Compass,
    tone: "guide",
    line: "Almost at your calorie target — a light snack fits if you're still hungry.",
    taglish: "Malapit ka na — pwede pa ng konting meryenda kung gutom ka pa.",
  };
}
