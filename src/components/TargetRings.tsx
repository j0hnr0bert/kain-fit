import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  macroTargetStatus,
  ringPercent,
  ringAriaLabel,
  isCalorieRingComplete,
} from "@/lib/food-display";

// One primary calorie ring + three compact macro rings, replacing the
// rectangular macro-pill target card. Identity colors only (never
// success/failure/medical judgment) — see styles.css for the token
// rationale. Ring size/spacing here is deliberately tuned, not arbitrary:
// verified via a disconnected visual-QA harness to render with zero
// horizontal overflow and clamped internal-element overflow at the
// project's smallest supported width (320px), including 4-digit calorie
// and 3-digit macro/target values.

type ProgressRingProps = {
  size: number;
  strokeWidth: number;
  percent: number;
  color: string;
  label: string;
  /** Remount key for the one-shot "just added" pulse — pass a value that
   * changes on every new save (e.g. a save sequence number) so the
   * animation always plays fresh and never replays from an unrelated
   * rerender (a stable key across rerenders keeps the same DOM node, so
   * the animation only ever runs once per genuine new value). */
  pulseKey?: number | string;
  /** Extra class applied only alongside the pulse remount (e.g. the gold
   * completion glow) — never persists past the one-shot animation. */
  extraClassName?: string;
  /** Small corner badge (e.g. the gold-completion checkmark) — rendered
   * absolutely positioned at the ring's edge, independent of the centered
   * `children` value/label stack. Kept separate from `children` so a
   * 4-digit calorie value never has to compete with a checkmark glyph for
   * the same tight center width (the inline version overflowed the ring
   * at 4-digit calorie totals — see the QA harness's overflow check). */
  badge?: React.ReactNode;
  children?: React.ReactNode;
};

function ProgressRing({
  size,
  strokeWidth,
  percent,
  color,
  label,
  pulseKey,
  extraClassName,
  badge,
  children,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  const center = size / 2;
  return (
    <div
      key={pulseKey}
      className={cn("relative", pulseKey != null && "ring-just-added", extraClassName)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset }}
          transform={`rotate(-90 ${center} ${center})`}
          className="ring-progress-arc"
        />
      </svg>
      {children && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden="true"
        >
          {children}
        </div>
      )}
      {badge && (
        <div className="absolute -top-0.5 -right-0.5" aria-hidden="true">
          {badge}
        </div>
      )}
    </div>
  );
}

const CALORIE_RING_SIZE = 80;
const CALORIE_RING_STROKE = 8;
const MACRO_RING_SIZE = 42;
const MACRO_RING_STROKE = 4.5;

function CalorieRing({
  value,
  target,
  pulseKey,
  justCompletedGold,
}: {
  value: number;
  target: number | null;
  pulseKey?: number;
  /** True only in the render where this exact save closed out the calorie
   * target for the first time (see coaching.ts's
   * saveCausedCalorieCompletion) — gates the one-shot gold glow so an
   * already-complete ring on refresh, or an unrelated rerender, never
   * replays it. The gold stroke color itself is not gated by this — it is
   * always derived from the current value/target, so "already completed
   * before this save" still renders gold, just without the glow. */
  justCompletedGold?: boolean;
}) {
  if (target == null || target <= 0) {
    return (
      <div
        className="flex flex-shrink-0 flex-col items-center justify-center rounded-full bg-muted"
        style={{ width: CALORIE_RING_SIZE, height: CALORIE_RING_SIZE }}
        role="img"
        aria-label={ringAriaLabel("Calories", value, target, " kcal")}
      >
        <div className="text-xl font-bold leading-none">{Math.round(value)}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">kcal</div>
      </div>
    );
  }
  const percent = ringPercent(value, target);
  const complete = isCalorieRingComplete(value, target);
  return (
    <div className="flex-shrink-0">
      <ProgressRing
        size={CALORIE_RING_SIZE}
        strokeWidth={CALORIE_RING_STROKE}
        percent={percent}
        color={complete ? "var(--color-ring-calories-complete)" : "var(--color-ring-calories)"}
        label={ringAriaLabel("Calories", value, target, " kcal")}
        pulseKey={pulseKey}
        extraClassName={complete && justCompletedGold ? "ring-gold-glow" : undefined}
        badge={
          complete ? (
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-card ring-1 ring-ring-calories-complete">
              <Check className="h-2.5 w-2.5 text-ring-calories-complete" aria-hidden="true" />
            </div>
          ) : undefined
        }
      >
        <div className="text-xl font-bold leading-none">{Math.round(value)}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
          /{Math.round(target)} kcal
        </div>
      </ProgressRing>
    </div>
  );
}

function MacroRing({
  label,
  value,
  target,
  color,
  pulseKey,
}: {
  label: string;
  value: number;
  target: number | null;
  color: string;
  pulseKey?: number;
}) {
  const status = macroTargetStatus(value, target);
  const ariaLabel = ringAriaLabel(label, value, target, "g");
  if (status === "no-target") {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
        <div
          className="flex items-center justify-center rounded-full bg-muted"
          style={{ width: MACRO_RING_SIZE, height: MACRO_RING_SIZE }}
          role="img"
          aria-label={ariaLabel}
        >
          <span className="text-[11px] font-bold">{Math.round(value)}</span>
        </div>
        <div className="text-[10.5px] font-medium text-foreground whitespace-nowrap">{label}</div>
      </div>
    );
  }
  const percent = ringPercent(value, target);
  const achieved = status === "achieved" || status === "over-target";
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <ProgressRing
        size={MACRO_RING_SIZE}
        strokeWidth={MACRO_RING_STROKE}
        percent={percent}
        color={color}
        label={ariaLabel}
        pulseKey={pulseKey}
      >
        <span className="flex items-center gap-0.5 text-[11px] font-bold">
          {Math.round(value)}
          {achieved && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
        </span>
      </ProgressRing>
      <div className="text-[10.5px] font-medium text-foreground whitespace-nowrap">{label}</div>
      <div className="text-[9.5px] text-muted-foreground whitespace-nowrap">
        /{Math.round(target as number)}g
      </div>
    </div>
  );
}

export type JustAdded = { calories: boolean; protein: boolean; carbs: boolean; fat: boolean };

export function TargetRings({
  calories,
  calorieTarget,
  protein,
  proteinTarget,
  carbs,
  carbsTarget,
  fat,
  fatTarget,
  justAdded,
  pulseSeq,
  justCompletedGold,
}: {
  calories: number;
  calorieTarget: number | null;
  protein: number;
  proteinTarget: number | null;
  carbs: number;
  carbsTarget: number | null;
  fat: number;
  fatTarget: number | null;
  /** Which rings received a positive delta from the most recent save —
   * only those rings get the one-shot pulse. */
  justAdded?: JustAdded;
  /** Changes on every new save; combined with justAdded to force the pulse
   * to remount (and thus replay) only for a genuinely new save, never for
   * an unrelated rerender. */
  pulseSeq?: number;
  /** True only for the render where this exact save closed out the calorie
   * target for the first time — see coaching.ts's
   * saveCausedCalorieCompletion. Never true on refresh or an unrelated
   * rerender, even when the ring is already gold. */
  justCompletedGold?: boolean;
}) {
  const pulseKeyFor = (field: keyof JustAdded) =>
    justAdded?.[field] && pulseSeq != null ? pulseSeq : undefined;
  return (
    <div className={cn("flex items-center gap-3")}>
      <CalorieRing
        value={calories}
        target={calorieTarget}
        pulseKey={pulseKeyFor("calories")}
        justCompletedGold={justCompletedGold}
      />
      <div className="flex min-w-0 flex-1 justify-between gap-2">
        <MacroRing
          label="Protein"
          value={protein}
          target={proteinTarget}
          color="var(--color-ring-protein)"
          pulseKey={pulseKeyFor("protein")}
        />
        <MacroRing
          label="Carbs"
          value={carbs}
          target={carbsTarget}
          color="var(--color-ring-carbs)"
          pulseKey={pulseKeyFor("carbs")}
        />
        <MacroRing
          label="Fat"
          value={fat}
          target={fatTarget}
          color="var(--color-ring-fat)"
          pulseKey={pulseKeyFor("fat")}
        />
      </div>
    </div>
  );
}
