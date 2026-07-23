import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitFeedback } from "@/lib/beta.functions";
import { getAcquisitionSource, track } from "@/lib/analytics";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            role="radio"
            aria-checked={value === n}
            className={cn(
              "h-10 flex-1 rounded-xl border text-sm font-medium transition",
              value === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedbackDialog({
  open,
  onOpenChange,
  anonymousSessionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  anonymousSessionId: string;
}) {
  const [ease, setEase] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [confusing, setConfusing] = useState("");
  const [missed, setMissed] = useState("");
  const [useTomorrow, setUseTomorrow] = useState<"yes" | "maybe" | "no" | null>(null);
  const [comment, setComment] = useState("");
  const [allowContact, setAllowContact] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const send = useServerFn(submitFeedback);

  const hasContent =
    ease !== null ||
    accuracy !== null ||
    useTomorrow !== null ||
    confusing.trim().length > 0 ||
    missed.trim().length > 0 ||
    comment.trim().length > 0;

  const trimmedEmail = contactEmail.trim();
  const emailValid = !trimmedEmail || /.+@.+\..+/.test(trimmedEmail);

  async function submit() {
    if (saving) return;
    if (!hasContent) {
      toast.error("Please share at least one rating, answer, or comment.");
      return;
    }
    if (allowContact && !emailValid) {
      toast.error("Please enter a valid email or turn off contact.");
      return;
    }
    setSaving(true);
    try {
      const commentWithContact =
        allowContact && trimmedEmail
          ? `${comment.trim()}\n\n[contact: ${trimmedEmail}]`.trim()
          : comment.trim() || null;
      await send({
        data: {
          anonymous_session_id: anonymousSessionId,
          ease_rating: ease,
          accuracy_rating: accuracy,
          confusing: confusing.trim() || null,
          missed_food: missed.trim() || null,
          would_use_tomorrow: useTomorrow,
          comment: commentWithContact || null,
          allow_contact: allowContact,
          acquisition_source: getAcquisitionSource(),
        },
      });
      track("feedback_submitted", {});
      toast.success("Thanks for the feedback");
      onOpenChange(false);
      setEase(null);
      setAccuracy(null);
      setConfusing("");
      setMissed("");
      setUseTomorrow(null);
      setComment("");
      setAllowContact(false);
      setContactEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Two quick ratings and anything you want us to know. All fields optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RatingRow label="How easy was this to use?" value={ease} onChange={setEase} />
          <RatingRow
            label="How accurate did the result feel?"
            value={accuracy}
            onChange={setAccuracy}
          />

          <div className="space-y-1.5">
            <Label htmlFor="fb-confusing">Was anything confusing?</Label>
            <Textarea
              id="fb-confusing"
              value={confusing}
              onChange={(e) => setConfusing(e.target.value.slice(0, 1000))}
              className="min-h-16 rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-missed">What food could KainFit not understand?</Label>
            <Textarea
              id="fb-missed"
              value={missed}
              onChange={(e) => setMissed(e.target.value.slice(0, 500))}
              className="min-h-16 rounded-xl"
            />
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Would you use this tomorrow?</div>
            <div className="grid grid-cols-3 gap-2">
              {(["yes", "maybe", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setUseTomorrow(v)}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium capitalize",
                    useTomorrow === v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-comment">Optional comment</Label>
            <Textarea
              id="fb-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 2000))}
              className="min-h-16 rounded-xl"
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allowContact}
              onCheckedChange={(v) => setAllowContact(v === true)}
              className="mt-0.5"
            />
            <span>Okay to contact me about this feedback</span>
          </label>
          {allowContact && (
            <div className="space-y-1.5">
              <Label htmlFor="fb-email">Email (optional)</Label>
              <Input
                id="fb-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value.slice(0, 200))}
                placeholder="you@example.com"
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Optional. We'll only use this to follow up on this feedback and won't add you to any
                list. Leave blank to stay anonymous.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={submit}
            disabled={saving || !hasContent}
            className="w-full h-11 rounded-2xl"
          >
            {saving ? "Sending…" : "Send feedback"}
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
