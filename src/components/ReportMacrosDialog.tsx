import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitMacroReport, submitFeedback } from "@/lib/beta.functions";
import { track, getAcquisitionSource } from "@/lib/analytics";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type IssueType =
  | "calories"
  | "protein"
  | "carbs"
  | "fat"
  | "serving_quantity"
  | "wrong_food"
  | "other";

const OPTIONS: { value: IssueType; label: string }[] = [
  { value: "wrong_food", label: "Wrong food" },
  { value: "serving_quantity", label: "Wrong quantity" },
  { value: "calories", label: "Calories" },
  { value: "protein", label: "Protein" },
  { value: "carbs", label: "Carbohydrates" },
  { value: "fat", label: "Fat" },
  { value: "other", label: "Other" },
];

export function ReportMacrosDialog({
  open,
  onOpenChange,
  foodEntryId,
  originalValues,
  disabled,
  anonymousSessionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  foodEntryId: string | null;
  originalValues: Record<string, unknown>;
  disabled?: boolean;
  /** When provided (demo / unauthenticated), the report is routed through the
   *  public feedback endpoint instead of the authenticated macro_reports table. */
  anonymousSessionId?: string;
}) {
  const [issue, setIssue] = useState<IssueType>("wrong_food");
  const [explanation, setExplanation] = useState("");
  const [saving, setSaving] = useState(false);
  const send = useServerFn(submitMacroReport);
  const sendPublic = useServerFn(submitFeedback);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      if (anonymousSessionId) {
        const label = OPTIONS.find((o) => o.value === issue)?.label ?? issue;
        const summary = `demo report: ${label}${
          originalValues?.display_name ? ` — ${String(originalValues.display_name)}` : ""
        }`;
        await sendPublic({
          data: {
            anonymous_session_id: anonymousSessionId,
            ease_rating: null,
            accuracy_rating: null,
            confusing: null,
            missed_food: summary.slice(0, 500),
            would_use_tomorrow: null,
            comment: explanation.trim() || null,
            allow_contact: false,
            acquisition_source: getAcquisitionSource(),
          },
        });
      } else {
        await send({
          data: {
            food_entry_id: foodEntryId,
            issue_type: issue,
            explanation: explanation.trim() || null,
            original_values: originalValues,
            corrected_values: null,
          },
        });
      }
      track("incorrect_macros_reported", { issue_type: issue });
      toast.success("Thanks — we'll review this");
      setExplanation("");
      setIssue("wrong_food");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send report");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>Report incorrect macros</DialogTitle>
          <DialogDescription>
            Tell us what looks off. This helps us tune KainFit for Filipino food.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2" disabled={disabled || saving}>
          <legend className="text-sm font-medium mb-1">What seems incorrect?</legend>
          <div className="grid grid-cols-2 gap-2">
            {OPTIONS.map((o) => (
              <label
                key={o.value}
                className={
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer " +
                  (issue === o.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border")
                }
              >
                <input
                  type="radio"
                  name="issue"
                  value={o.value}
                  checked={issue === o.value}
                  onChange={() => setIssue(o.value)}
                  className="accent-[oklch(0.55_0.11_195)]"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="rep-exp">Optional explanation</Label>
          <Textarea
            id="rep-exp"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value.slice(0, 1000))}
            placeholder="e.g. 'the rice serving looked closer to 250g'"
            className="min-h-24 rounded-xl"
          />
          <p className="text-[11px] text-muted-foreground">{explanation.length}/1000</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={submit} disabled={saving} className="w-full h-11 rounded-2xl">
            {saving ? "Sending…" : "Send report"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full h-11 rounded-2xl"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
