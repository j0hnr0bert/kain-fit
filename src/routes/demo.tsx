import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowUp, Sparkles, Trash2, Loader2, MessageSquare, AlertCircle,
  Flag, Pencil, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { track, getAcquisitionSource } from "@/lib/analytics";
import { BetaBadge } from "@/components/BetaBadge";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { ReportMacrosDialog } from "@/components/ReportMacrosDialog";
import { parseFoodDemo, getDemoStatus, recalcItemDemo } from "@/lib/food.functions";
import { formatQuantity, foodStatus, isPreparationClarification } from "@/lib/food-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Try the demo — KainFit" },
      { name: "description", content: "Explore a sample KainFit Today screen without creating an account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoPage,
});

type Meal = "breakfast" | "lunch" | "dinner" | "snacks";

type DemoEntry = {
  id: string;
  meal: Meal;
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  data_source: string;
  is_estimate: boolean;
  confidence: number;
};

type PendingItem = {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation?: string | null;
  meal_type: Meal;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  confidence: number;
  is_estimate: boolean;
  clarification_needed: boolean;
  clarification_question?: string | null;
};

const PENDING_STORAGE_KEY = "kf.demoPendingImport";
const DEMO_LIMIT = 3;

function mealFromHour(h: number): Meal {
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 20) return "dinner";
  return "snacks";
}

function DemoPage() {
  const navigate = useNavigate();
  const parseFn = useServerFn(parseFoodDemo);
  const statusFn = useServerFn(getDemoStatus);
  const recalcFn = useServerFn(recalcItemDemo);
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<DemoEntry[]>([]);
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState("");
  const [pending, setPending] = useState<PendingItem[] | null>(null);
  const [pendingOriginalInput, setPendingOriginalInput] = useState("");
  // Row indices currently being recalculated (preparation / edit changes).
  // Prevents adding to the day while nutrition values are stale.
  const [recalcingRows, setRecalcingRows] = useState<Set<number>>(new Set());
  const anyRecalcing = recalcingRows.size > 0;
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [signupPrompt, setSignupPrompt] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    id: string | null;
    values: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    track("demo_started", { demo_or_registered: "demo" });
  }, []);

  // Fetch the authoritative remaining allowance on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await statusFn();
        if (cancelled) return;
        setRemaining(s.remaining);
        if (s.remaining <= 0) setLimitReached(true);
      } catch {
        if (cancelled) return;
        // If status fails, keep remaining=null so the UI stays in "checking" state
        // rather than optimistically showing a number.
        setRemaining(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFn]);

  const totals = useMemo(
    () =>
      entries.reduce(
        (a, e) => ({
          calories: a.calories + e.calories,
          protein: a.protein + e.protein,
          carbs: a.carbs + e.carbs,
          fat: a.fat + e.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [entries],
  );

  const grouped = useMemo(() => {
    const g: Record<Meal, DemoEntry[]> = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    entries.forEach((e) => g[e.meal].push(e));
    return g;
  }, [entries]);

  async function runParse(text: string) {
    setParsing(true);
    setParseError(null);
    setLastInput(text);
    const started = performance.now();
    track("demo_food_submitted", { demo_or_registered: "demo" });
    const highDemandTimer =
      typeof window !== "undefined"
        ? window.setTimeout(
            () => setParseError("Demand is unusually high — still working on it."),
            10_000,
          )
        : null;
    try {
      const mealHint = mealFromHour(new Date().getHours());
      const result = await parseFn({ data: { input: text, mealHint } });
      const dur = Math.round(performance.now() - started);
      if (typeof result.remaining === "number") {
        setRemaining(result.remaining);
        if (result.remaining <= 0) setLimitReached(true);
      }
      if (!result.items || result.items.length === 0) {
        track("food_parse_failed", { processing_duration_ms: dur, reason: "empty_result", demo_or_registered: "demo" });
        setParseError("We couldn't find any food in that. Please rephrase and try again.");
        return;
      }
      track("food_parse_succeeded", {
        processing_duration_ms: dur,
        number_of_items: result.items.length,
        input_language: result.input_language,
        estimated_item_count: result.items.filter((i) => i.is_estimate).length,
        verified_item_count: result.items.filter((i) => !i.is_estimate).length,
        demo_or_registered: "demo",
        ai_parsing_ms: result.timings?.ai_parsing_ms,
        resolution_path: result.timings?.resolution_path,
        cache_hit: result.timings?.cache_hit,
      });
      setPending(result.items as PendingItem[]);
      setPendingOriginalInput(text);
    } catch (err) {
      const dur = Math.round(performance.now() - started);
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "DEMO_LIMIT_REACHED") {
        setLimitReached(true);
        setSignupPrompt(true);
        setParseError(null);
      } else {
        track("food_parse_failed", { processing_duration_ms: dur, reason: msg.slice(0, 80), demo_or_registered: "demo" });
        if (msg.startsWith("AI_UNAVAILABLE:")) {
          setParseError(
            "KainFit's calculator is temporarily unavailable. Please try again in a minute.",
          );
        } else if (msg.startsWith("AI_BUSY:")) {
          setParseError("Demand is unusually high. Please try again in a moment.");
        } else if (msg.startsWith("AI credits")) {
          setParseError(msg);
        } else {
          setParseError("Something went wrong calculating that. Please try again.");
        }
      }
    } finally {
      if (highDemandTimer !== null) window.clearTimeout(highDemandTimer);
      setParsing(false);
    }
  }

  function handleTry(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || parsing) return;
    if (remaining === null) return; // still checking availability
    if (limitReached || remaining <= 0) {
      setSignupPrompt(true);
      return;
    }
    void runParse(input.trim());
  }

  function confirmAdd() {
    if (!pending) return;
    if (anyRecalcing) return;
    const added: DemoEntry[] = pending.map((i, idx) => ({
      id: `d-${Date.now()}-${idx}`,
      meal: i.meal_type,
      name: i.display_name,
      quantity: Number(i.quantity),
      unit: i.unit,
      calories: Math.round(i.calories),
      protein: Math.round(i.protein_g),
      carbs: Math.round(i.carbs_g),
      fat: Math.round(i.fat_g),
      data_source: i.data_source,
      is_estimate: i.is_estimate,
      confidence: i.confidence,
    }));
    setEntries((prev) => [...prev, ...added]);
    track("demo_food_confirmed", {
      demo_or_registered: "demo",
      number_of_items: pending.length,
    });
    setPending(null);
    setPendingOriginalInput("");
    setInput("");
    toast.success("Added to demo day");
  }

  async function recalcRow(idx: number, next: PendingItem) {
    // Optimistically update label/quantity fields, then fetch new macros.
    setPending((p) => p!.map((it, i) => (i === idx ? next : it)));
    setRecalcingRows((s) => {
      const n = new Set(s);
      n.add(idx);
      return n;
    });
    try {
      const prep =
        next.preparation === "raw" || next.preparation === "cooked"
          ? next.preparation
          : "estimated";
      const out = await recalcFn({
        data: {
          display_name: next.display_name,
          normalized_name: next.normalized_name,
          quantity: Number(next.quantity),
          unit: next.unit,
          preparation: prep,
        },
      });
      setPending((p) =>
        p
          ? p.map((it, i) =>
              i === idx
                ? {
                    ...it,
                    calories: out.calories,
                    protein_g: out.protein_g,
                    carbs_g: out.carbs_g,
                    fat_g: out.fat_g,
                    data_source: out.data_source,
                    confidence: out.confidence,
                    is_estimate: out.is_estimate,
                  }
                : it,
            )
          : p,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not recalculate.";
      toast.error(msg);
    } finally {
      setRecalcingRows((s) => {
        const n = new Set(s);
        n.delete(idx);
        return n;
      });
    }
  }

  function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function requireAccount() {
    if (entries.length > 0) {
      try {
        sessionStorage.setItem(
          PENDING_STORAGE_KEY,
          JSON.stringify({ savedAt: Date.now(), entries }),
        );
      } catch {
        // ignore storage failure — we'll just skip import
      }
    }
    setSignupPrompt(true);
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-16">
      <div
        className="max-w-md mx-auto px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground -ml-2 px-2 py-1"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="flex items-center gap-2">
            <BetaBadge />
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="text-sm font-medium text-primary px-2 py-1"
            >
              Create account
            </Link>
          </div>
        </div>

        {/* Demo banner */}
        <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-foreground">Demo mode</div>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Your entry is processed to generate this preview but is not saved to an account.{" "}
              {remaining === null ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Checking demo availability…
                </span>
              ) : (
                <>You have {remaining} free {remaining === 1 ? "calculation" : "calculations"} left.</>
              )}
            </p>
          </div>
        </div>

        {/* Totals */}
        <div className="mt-5 rounded-3xl bg-card border border-border p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Today · demo</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="text-5xl font-bold tracking-tight">{totals.calories}</div>
            <div className="text-sm text-muted-foreground">kcal</div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <MacroPill label="Protein" value={totals.protein} />
            <MacroPill label="Carbs" value={totals.carbs} />
            <MacroPill label="Fat" value={totals.fat} />
          </div>
        </div>

        {/* Input */}
        <form onSubmit={handleTry} className="mt-5">
          <div className="relative rounded-3xl bg-card border border-border shadow-sm focus-within:border-primary transition">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Try: 200g chicken breast and 150g rice"
              aria-label="Describe what you ate"
              className="h-14 pl-5 pr-14 bg-transparent border-0 rounded-3xl text-base focus-visible:ring-0"
              disabled={parsing || limitReached || remaining === null}
              ref={inputRef}
            />
            <button
              type="submit"
              disabled={parsing || !input.trim() || limitReached || remaining === null}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
              aria-label="Calculate nutrition"
            >
              {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Uses the same nutrition engine as the full app. Your entry is sent securely to be
            calculated and is not saved to any account.
          </p>
          {parsing && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Calculating nutrition…
            </div>
          )}
          {parseError && !parsing && (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div>{parseError}</div>
                {lastInput && (
                  <button
                    type="button"
                    onClick={() => runParse(lastInput)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                  >
                    <RefreshCw className="h-3 w-3" /> Try again
                  </button>
                )}
              </div>
            </div>
          )}
          {limitReached && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
              You've completed your {DEMO_LIMIT} free demo calculations. Create a free account to
              continue tracking.
            </div>
          )}
        </form>

        {/* Log */}
        <div className="mt-6 space-y-6">
          {entries.length === 0 && !parsing && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nothing added yet. Type what you ate above to see real nutrition.
            </div>
          )}
          {(["breakfast", "lunch", "dinner", "snacks"] as const).map((m) => {
            const items = grouped[m];
            if (items.length === 0) return null;
            return (
              <div key={m}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 px-1">{m}</div>
                <div className="space-y-2">
                  {items.map((e) => (
                    <div key={e.id} className="rounded-2xl bg-card border border-border p-4 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{e.name}</span>
                          <DemoStatusBadge
                            data_source={e.data_source}
                            is_estimate={e.is_estimate}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatQuantity(e.quantity, e.unit)} · {e.calories} kcal · P {e.protein} · C {e.carbs} · F {e.fat}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              id: null,
                              values: {
                                display_name: e.name,
                                quantity: e.quantity,
                                unit: e.unit,
                                calories: e.calories,
                                protein_g: e.protein,
                                carbs_g: e.carbs,
                                fat_g: e.fat,
                              },
                            })
                          }
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Flag className="h-3 w-3" /> Report incorrect result
                        </button>
                      </div>
                      <button
                        onClick={() => remove(e.id)}
                        className="p-2 min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${e.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Save CTA */}
        <div className="mt-8">
          <Button
            type="button"
            onClick={requireAccount}
            disabled={entries.length === 0}
            className={cn("w-full h-12 rounded-2xl")}
          >
            Save this day to my account
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            You'll create a free account first. We'll ask before importing these entries.
          </p>
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="mt-4 w-full h-11 rounded-2xl text-sm text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquare className="h-4 w-4" /> Send feedback
          </button>
        </div>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        anonymousSessionId={typeof window !== "undefined" ? (localStorage.getItem("kf.sid") ?? "") : ""}
      />

      {/* Review sheet — same shape as production */}
      <Sheet
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <SheetContent
          side="bottom"
          aria-describedby="demo-review-desc"
          className="rounded-t-3xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Review before adding
            </SheetTitle>
            <SheetDescription id="demo-review-desc">
              Check each item's amount and nutrition. Answer any preparation
              questions, edit values if needed, then add them to your demo day.
            </SheetDescription>
          </SheetHeader>
          {pendingOriginalInput && (
            <p className="mt-2 text-xs text-muted-foreground">
              From: <span className="text-foreground">"{pendingOriginalInput}"</span>
            </p>
          )}
          <div className="mt-4 space-y-3">
            {pending?.map((item, idx) => (
              <PendingRow
                key={idx}
                item={item}
                recalcing={recalcingRows.has(idx)}
                onRecalc={(next) => void recalcRow(idx, next)}
                onChange={(next) =>
                  setPending((p) => p!.map((it, i) => (i === idx ? next : it)))
                }
                onRemove={() =>
                  setPending((p) => (p!.length > 1 ? p!.filter((_, i) => i !== idx) : null))
                }
                onReport={() =>
                  setReportTarget({
                    id: null,
                    values: {
                      display_name: item.display_name,
                      quantity: item.quantity,
                      unit: item.unit,
                      calories: item.calories,
                      protein_g: item.protein_g,
                      carbs_g: item.carbs_g,
                      fat_g: item.fat_g,
                    },
                  })
                }
              />
            ))}
          </div>
          <div className="mt-6 space-y-2">
            <Button
              onClick={confirmAdd}
              disabled={anyRecalcing}
              className="w-full h-12 rounded-2xl"
            >
              {anyRecalcing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Recalculating…
                </span>
              ) : (
                "Add to demo day"
              )}
            </Button>
            <Button onClick={() => setPending(null)} variant="ghost" className="w-full h-12 rounded-2xl">
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ReportMacrosDialog
        open={reportTarget !== null}
        onOpenChange={(v) => { if (!v) setReportTarget(null); }}
        foodEntryId={null}
        originalValues={reportTarget?.values ?? {}}
        anonymousSessionId={typeof window !== "undefined" ? (localStorage.getItem("kf.sid") ?? "") : ""}
      />

      <Dialog open={signupPrompt} onOpenChange={setSignupPrompt}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {limitReached ? "You've reached the demo limit" : "Create an account to save"}
            </DialogTitle>
            <DialogDescription>
              {limitReached
                ? `You've completed your ${DEMO_LIMIT} free demo calculations. Create a free account to continue tracking.`
                : "We'll create your free account first. After you're signed in, you can choose whether to import today's demo entries."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full h-12 rounded-2xl"
              onClick={() => {
                const source = getAcquisitionSource();
                navigate({
                  to: "/auth",
                  search: {
                    mode: "signup",
                    ...(source ? { source } : {}),
                  } as { mode: "signup"; source?: string },
                });
              }}
            >
              Create account
            </Button>
            <Button
              variant="ghost"
              className="w-full h-12 rounded-2xl"
              onClick={() => setSignupPrompt(false)}
            >
              {limitReached ? "Close" : "Keep exploring the demo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MacroPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-foreground">
        {value}
        <span className="text-xs font-normal text-muted-foreground ml-0.5">g</span>
      </div>
    </div>
  );
}

function PendingRow({
  item, onChange, onRemove, onReport, onRecalc, recalcing,
}: {
  item: PendingItem;
  onChange: (next: PendingItem) => void;
  onRemove: () => void;
  onReport: () => void;
  onRecalc: (next: PendingItem) => void;
  recalcing: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftQty, setDraftQty] = useState<number>(item.quantity);
  const [draftUnit, setDraftUnit] = useState<string>(item.unit);
  useEffect(() => {
    setDraftQty(item.quantity);
    setDraftUnit(item.unit);
  }, [item.quantity, item.unit]);
  const prepClarification =
    item.clarification_needed && isPreparationClarification(item.clarification_question);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {item.clarification_needed && item.clarification_question && !prepClarification && (
        <div className="mb-3 rounded-xl bg-amber-brand/10 text-[oklch(0.4_0.16_75)] text-xs p-2">
          {item.clarification_question}
        </div>
      )}
      {prepClarification && (
        <div className="mb-3 rounded-xl bg-amber-brand/10 p-2.5">
          <div className="text-xs font-medium text-[oklch(0.4_0.16_75)] mb-1.5">
            Was that weighed raw or cooked?
          </div>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Preparation">
            {(["raw", "cooked", "not sure"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={
                  choice === "not sure"
                    ? item.preparation === "estimated"
                    : item.preparation === choice
                }
                onClick={() => {
                  const nextPrep = choice === "not sure" ? "estimated" : choice;
                  onRecalc({
                    ...item,
                    preparation: nextPrep,
                    is_estimate: nextPrep === "estimated" ? true : item.is_estimate,
                    clarification_needed: false,
                  });
                }}
                disabled={recalcing}
                className="h-9 rounded-lg border border-border bg-background text-xs font-medium capitalize hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {choice}
              </button>
            ))}
          </div>
          {item.preparation === "estimated" && !recalcing && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Using a middle-ground estimate. You can change this any time.
            </div>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.display_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatQuantity(item.quantity, item.unit)}
            {item.preparation && item.preparation !== "estimated"
              ? ` · ${item.preparation}`
              : ""}
            {recalcing && (
              <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Recalculating…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setEditing((v) => !v)} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onRemove} className="p-2 text-muted-foreground hover:text-destructive" aria-label="Remove">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <NumCell label="kcal" value={item.calories} onChange={(v) => onChange({ ...item, calories: v })} editing={editing} />
        <NumCell label="P" value={item.protein_g} onChange={(v) => onChange({ ...item, protein_g: v })} editing={editing} />
        <NumCell label="C" value={item.carbs_g} onChange={(v) => onChange({ ...item, carbs_g: v })} editing={editing} />
        <NumCell label="F" value={item.fat_g} onChange={(v) => onChange({ ...item, fat_g: v })} editing={editing} />
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Quantity
              <Input
                type="number"
                value={draftQty}
                onChange={(e) => setDraftQty(Number(e.target.value))}
                className="mt-1 h-10 rounded-xl"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Unit
              <Input
                value={draftUnit}
                onChange={(e) => setDraftUnit(e.target.value)}
                className="mt-1 h-10 rounded-xl"
              />
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={
              recalcing ||
              (draftQty === item.quantity && draftUnit === item.unit) ||
              !(draftQty >= 0) ||
              !draftUnit.trim()
            }
            onClick={() => {
              onRecalc({ ...item, quantity: draftQty, unit: draftUnit.trim() });
              setEditing(false);
            }}
            className="w-full h-9 rounded-xl"
          >
            Recalculate with new amount
          </Button>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-[11px] flex-wrap">
        <DemoStatusBadge
          data_source={item.data_source}
          is_estimate={item.is_estimate}
          preparation={item.preparation}
        />
        {item.confidence < 0.6 && (
          <span className="text-[oklch(0.5_0.16_75)]">Low confidence</span>
        )}
        <button
          type="button"
          onClick={onReport}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Flag className="h-3 w-3" /> Report incorrect result
        </button>
      </div>
    </div>
  );
}

function DemoStatusBadge({
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
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {info.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function NumCell({
  label, value, onChange, editing,
}: { label: string; value: number; onChange: (v: number) => void; editing: boolean }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      {editing ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-0.5 w-full text-center bg-transparent font-semibold outline-none"
        />
      ) : (
        <div className="mt-0.5 font-semibold">{Math.round(value)}</div>
      )}
    </div>
  );
}