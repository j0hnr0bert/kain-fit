import { AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { foodStatus } from "@/lib/food-display";
import { cn } from "@/lib/utils";

// Lazy-loaded from today.tsx — Radix Tooltip is only needed once a food
// entry actually renders (after the entries query resolves), never for the
// initial food-input-ready paint, so it shouldn't compete with that for
// parse/exec time on Today's critical path.
export default function StatusBadge({
  data_source,
  is_estimate,
  preparation,
}: {
  data_source: string;
  is_estimate?: boolean;
  preparation?: string | null;
}) {
  const info = foodStatus({ data_source, is_estimate, preparation });
  const tone =
    info.tone === "verified"
      ? "bg-primary/10 text-primary"
      : info.tone === "recipe"
        ? "bg-muted text-foreground/80"
        : info.tone === "user"
          ? "bg-muted text-muted-foreground"
          : "bg-amber-brand/15 text-[oklch(0.5_0.16_75)]";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Nutrition status: ${info.label}. ${info.tooltip}`}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tone,
            )}
          >
            {info.tone === "estimated" && <AlertCircle className="h-3 w-3" />}
            {info.label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{info.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
