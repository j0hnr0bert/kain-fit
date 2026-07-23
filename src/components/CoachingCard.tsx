import { Compass, PartyPopper, RotateCcw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoachingResult } from "@/lib/coaching";

type CoachingCardProps = {
  result: CoachingResult;
  proteinRemaining: number;
  weekly: { thisWeekDays: number; lastWeekDays: number };
};

type Content = {
  icon: typeof Compass;
  tone: "recover" | "guide" | "celebrate" | "reinforce";
  line: string;
  taglish: string;
};

export function CoachingCard({ result, proteinRemaining, weekly }: CoachingCardProps) {
  const content = messageFor(result, proteinRemaining, weekly);
  if (!content) return null;
  const Icon = content.icon;
  return (
    <div
      className={cn(
        "mt-3 rounded-2xl border p-4 flex items-start gap-3",
        content.tone === "celebrate" ? "border-primary/30 bg-primary/5" : "border-border bg-card",
      )}
    >
      <Icon
        className={cn(
          "h-5 w-5 mt-0.5 shrink-0",
          content.tone === "celebrate" ? "text-primary" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{content.line}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{content.taglish}</div>
      </div>
    </div>
  );
}

function messageFor(
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
        icon: PartyPopper,
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
