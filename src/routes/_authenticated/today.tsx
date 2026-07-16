import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseFood, recalcItem } from "@/lib/food.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BottomNav } from "@/components/BottomNav";
import { toast } from "sonner";
import {
  ArrowUp, Mic, Sparkles, Trash2, Pencil, Loader2, AlertCircle, Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { track, markReturned } from "@/lib/analytics";
import { BetaBadge } from "@/components/BetaBadge";
import { HighDemandBanner } from "@/components/HighDemandBanner";
import { ReportMacrosDialog } from "@/components/ReportMacrosDialog";
import { formatQuantity, foodStatus, isPreparationClarification } from "@/lib/food-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/_authenticated/today")({
  component: TodayPage,
});

type Entry = {
  id: string;
  logged_at: string;
  created_at?: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snacks";
  display_name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  is_estimate: boolean;
  preparation?: string | null;
};

type PendingItem = {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation?: string | null;
  meal_type: Entry["meal_type"];
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

function mealFromHour(h: number): Entry["meal_type"] {
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 20) return "dinner";
  return "snacks";
}

function TodayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parseFn = useServerFn(parseFood);
  const recalcFn = useServerFn(recalcItem);
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState<PendingItem[] | null>(null);
  const [recalcingRows, setRecalcingRows] = useState<Set<number>>(new Set());
  const anyRecalcing = recalcingRows.size > 0;
  const [originalInput, setOriginalInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    id: string | null;
    values: Record<string, unknown>;
  } | null>(null);
  const editedRef = useRef(false);
  const [demoImport, setDemoImport] = useState<{
    entries: Array<{
      meal: Entry["meal_type"];
      name: string;
      quantity: number;
      unit: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      data_source: string;
      is_estimate: boolean;
      confidence?: number;
    }>;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("kf.demoPendingImport");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        entries: Array<Record<string, unknown>>;
      };
      const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
      if (list.length === 0) {
        sessionStorage.removeItem("kf.demoPendingImport");
        return;
      }
      setDemoImport({
        entries: list.map((e) => ({
          meal: (e.meal as Entry["meal_type"]) ?? "snacks",
          name: String(e.name ?? "Demo item"),
          quantity: Number(e.quantity ?? 1),
          unit: String(e.unit ?? ""),
          calories: Number(e.calories ?? 0),
          protein: Number(e.protein ?? 0),
          carbs: Number(e.carbs ?? 0),
          fat: Number(e.fat ?? 0),
          data_source: String(e.data_source ?? "estimated"),
          is_estimate: Boolean(e.is_estimate),
          confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
        })),
      });
    } catch {
      // ignore malformed pending import
    }
  }, []);

  async function importDemoEntries() {
    if (!demoImport) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const rows = demoImport.entries.map((i) => ({
      user_id: u.user!.id,
      logged_at: new Date().toISOString(),
      meal_type: i.meal,
      original_input: "(imported from demo)",
      display_name: i.name,
      normalized_name: i.name.toLowerCase(),
      quantity: i.quantity,
      unit: i.unit,
      preparation: null,
      calories: Math.round(i.calories),
      protein_g: Math.round(i.protein),
      carbs_g: Math.round(i.carbs),
      fat_g: Math.round(i.fat),
      data_source: i.data_source,
      confidence: i.confidence ?? 0.7,
      is_estimate: i.is_estimate,
    }));
    const { error } = await supabase.from("food_entries").insert(rows);
    if (error) {
      toast.error(error.message);
      return;
    }
    try { sessionStorage.removeItem("kf.demoPendingImport"); } catch { /* ignore */ }
    setDemoImport(null);
    qc.invalidateQueries({ queryKey: ["entries", "today"] });
    toast.success(`Imported ${rows.length} demo ${rows.length === 1 ? "entry" : "entries"}`);
  }

  function dismissDemoImport() {
    try { sessionStorage.removeItem("kf.demoPendingImport"); } catch { /* ignore */ }
    setDemoImport(null);
  }

  useEffect(() => {
    markReturned();
  }, []);

  // Bounce to onboarding if not done
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data && !data.onboarded) navigate({ to: "/onboarding", replace: true });
    })();
  }, [navigate]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["entries", "today"],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("food_entries")
        .select("*")
        .gte("logged_at", start.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({
        calories: acc.calories + Number(e.calories),
        protein: acc.protein + Number(e.protein_g),
        carbs: acc.carbs + Number(e.carbs_g),
        fat: acc.fat + Number(e.fat_g),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [entries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || parsing) return;
    setParsing(true);
    setOriginalInput(input);
    editedRef.current = false;
    const started = performance.now();
    track("food_submitted", {});
    const highDemandTimer = window.setTimeout(() => {
      toast("Demand is unusually high — hang tight.", { duration: 6000 });
    }, 10_000);
    try {
      const mealHint = mealFromHour(new Date().getHours());
      const result = await parseFn({ data: { input, mealHint } });
      const dur = Math.round(performance.now() - started);
      if (result.items.length === 0) {
        track("food_parse_failed", { processing_duration_ms: dur, reason: "empty_result" });
        toast.error("Couldn't find any food in that. Try again.");
      } else {
        const estimated = result.items.filter((i) => i.is_estimate).length;
        const verified = result.items.length - estimated;
        const anyClar = result.items.some((i) => i.clarification_needed);
        track("food_parse_succeeded", {
          processing_duration_ms: dur,
          number_of_items: result.items.length,
          input_language: result.input_language,
          clarification_required: anyClar,
          estimated_item_count: estimated,
          verified_item_count: verified,
          ai_parsing_ms: result.timings?.ai_parsing_ms,
          resolution_path: result.timings?.resolution_path,
          cache_hit: result.timings?.cache_hit,
        });
        if (anyClar) track("food_clarification_requested", { number_of_items: result.items.length });
        setPending(result.items);
      }
    } catch (err) {
      track("food_parse_failed", {
        processing_duration_ms: Math.round(performance.now() - started),
        reason: err instanceof Error ? err.message.slice(0, 80) : "unknown",
      });
      const msg = err instanceof Error ? err.message : "Could not parse. Try again.";
      if (msg.startsWith("AI_UNAVAILABLE:")) {
        toast.error(
          "KainFit's calculator is temporarily unavailable. Your existing entries and history stay available.",
        );
      } else if (msg.startsWith("AI_BUSY:")) {
        toast.error("Demand is unusually high. Please try again in a moment.");
      } else {
        toast.error(msg);
      }
    } finally {
      window.clearTimeout(highDemandTimer);
      setParsing(false);
    }
  }

  function startVoice() {
    const SR: any =
      (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    if (!SR) {
      toast.error("Voice input isn't supported on this device.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-PH";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const text = ev.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + text : text));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function confirmAdd() {
    if (!pending) return;
    if (anyRecalcing) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    if (editedRef.current) track("food_edited_before_confirmation", { number_of_items: pending.length });
    // Idempotency: one shared client_request_id for this confirm batch.
    // Duplicate taps or retries hit the unique index on (user_id, client_request_id).
    const clientRequestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows = pending.map((i) => ({
      user_id: u.user!.id,
      logged_at: new Date().toISOString(),
      meal_type: i.meal_type,
      original_input: originalInput,
      display_name: i.display_name,
      normalized_name: i.normalized_name,
      quantity: i.quantity,
      unit: i.unit,
      preparation: i.preparation,
      calories: Math.round(i.calories),
      protein_g: Math.round(i.protein_g),
      carbs_g: Math.round(i.carbs_g),
      fat_g: Math.round(i.fat_g),
      data_source: i.data_source,
      confidence: i.confidence,
      is_estimate: i.is_estimate,
      client_request_id: clientRequestId,
    }));
    const { error } = await supabase.from("food_entries").insert(rows);
    if (error) {
      // Duplicate confirmation (double-tap / retry) — treat as success.
      if (error.code === "23505") {
        setPending(null);
        setInput("");
        qc.invalidateQueries({ queryKey: ["entries", "today"] });
        return;
      }
      toast.error(error.message);
      return;
    }
    track("food_confirmed", { number_of_items: pending.length });
    setPending(null);
    setInput("");
    toast.success("Added to today");
    qc.invalidateQueries({ queryKey: ["entries", "today"] });
  }

  async function deleteEntry(entry: Entry) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    const { error } = await supabase.from("food_entries").delete().eq("id", entry.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    track("food_deleted", {});
    qc.invalidateQueries({ queryKey: ["entries", "today"] });
    toast("Entry deleted", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          if (!uid) return;
          const { id, ...rest } = entry;
          await supabase.from("food_entries").insert({ ...rest, user_id: uid });
          qc.invalidateQueries({ queryKey: ["entries", "today"] });
        },
      },
    });
  }

  async function updateEntryAmount(entry: Entry, newQuantity: number) {
    const oldQ = Number(entry.quantity) || 0;
    if (!(newQuantity > 0)) {
      toast.error("Enter an amount greater than 0.");
      return false;
    }
    if (newQuantity > 100000) {
      toast.error("That amount looks too large.");
      return false;
    }
    // Linear recalc from stored per-unit values — no AI call.
    const ratio = oldQ > 0 ? newQuantity / oldQ : 1;
    const patch = {
      quantity: newQuantity,
      calories: Math.round(Number(entry.calories) * ratio),
      protein_g: Math.round(Number(entry.protein_g) * ratio),
      carbs_g: Math.round(Number(entry.carbs_g) * ratio),
      fat_g: Math.round(Number(entry.fat_g) * ratio),
    };
    const { error } = await supabase
      .from("food_entries")
      .update(patch)
      .eq("id", entry.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    qc.invalidateQueries({ queryKey: ["entries", "today"] });
    return true;
  }

  async function recalcRow(idx: number, next: PendingItem) {
    editedRef.current = true;
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

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Magandang umaga";
    if (h < 18) return "Magandang hapon";
    return "Magandang gabi";
  }, []);

  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const placeholderExamples = useMemo(
    () => [
      "150g chicken adobo and 200g cooked rice",
      "3 eggs and 2 slices of bread",
      "250g raw chicken breast",
      "1 cup oatmeal with banana",
      "200g grilled salmon and salad",
    ],
    [],
  );
  useEffect(() => {
    const t = window.setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % placeholderExamples.length),
      4000,
    );
    return () => window.clearInterval(t);
  }, [placeholderExamples.length]);

  function formatEntryTime(iso: string | undefined) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <HighDemandBanner />
      <div
        className="max-w-md mx-auto px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-muted-foreground">{greeting}</div>
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">
                {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </div>
              <BetaBadge />
            </div>
          </div>
          <button
            onClick={() => navigate({ to: "/profile" })}
            className="h-10 w-10 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center"
            aria-label="Profile"
          >
            <UserInitial />
          </button>
        </div>

        {/* Totals */}
        <div className="rounded-3xl bg-card border border-border p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Today</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="text-5xl font-bold tracking-tight">{Math.round(totals.calories)}</div>
            <div className="text-sm text-muted-foreground">kcal</div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <MacroPill label="Protein" value={totals.protein} color="text-primary" />
            <MacroPill label="Carbs" value={totals.carbs} color="text-[oklch(0.72_0.19_145)]" />
            <MacroPill label="Fat" value={totals.fat} color="text-[oklch(0.68_0.17_25)]" />
          </div>
        </div>

        {/* Entry */}
        <form onSubmit={handleSubmit} className="mt-5">
          <div className="relative rounded-3xl bg-card border border-border shadow-sm focus-within:border-primary transition">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What did you eat?"
              className="h-14 pl-5 pr-24 bg-transparent border-0 rounded-3xl text-base focus-visible:ring-0"
              disabled={parsing}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                type="button"
                onClick={startVoice}
                disabled={parsing}
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center",
                  listening ? "bg-coral text-coral-foreground animate-pulse" : "text-muted-foreground hover:bg-muted",
                )}
                aria-label="Voice input"
              >
                <Mic className="h-5 w-5" />
              </button>
              <button
                type="submit"
                disabled={parsing || !input.trim()}
                className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
                aria-label="Submit"
              >
                {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Try: <span className="text-foreground/80">150g chicken adobo and 200g rice</span>
          </p>
        </form>

        {/* Log */}
        <div className="mt-8 space-y-6">
          {isLoading && (
            <div className="text-sm text-muted-foreground">Loading today's log…</div>
          )}
          {!isLoading && entries.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nothing logged yet. Type what you ate above.
            </div>
          )}
          {(["breakfast", "lunch", "dinner", "snacks"] as const).map((meal) => {
            const items = grouped[meal];
            if (items.length === 0) return null;
            return (
              <div key={meal}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 px-1">
                  {meal}
                </div>
                <div className="space-y-2">
                  {items.map((e) => (
                    <div key={e.id} className="rounded-2xl bg-card border border-border p-4 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{e.display_name}</span>
                          <StatusBadge
                            data_source={e.data_source}
                            is_estimate={e.is_estimate}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatQuantity(e.quantity, e.unit)} · {Math.round(e.calories)} kcal ·
                          P {Math.round(e.protein_g)} · C {Math.round(e.carbs_g)} · F {Math.round(e.fat_g)}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              id: e.id,
                              values: {
                                display_name: e.display_name,
                                quantity: e.quantity,
                                unit: e.unit,
                                calories: e.calories,
                                protein_g: e.protein_g,
                                carbs_g: e.carbs_g,
                                fat_g: e.fat_g,
                              },
                            })
                          }
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Flag className="h-3 w-3" /> Report incorrect macros
                        </button>
                      </div>
                      <button onClick={() => deleteEntry(e)} className="p-2 text-muted-foreground hover:text-destructive" aria-label="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Review sheet */}
      <Sheet
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            // Return focus to the food input after the review dialog closes.
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <SheetContent
          side="bottom"
          aria-describedby="today-review-desc"
          className="rounded-t-3xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Review before adding
            </SheetTitle>
            <SheetDescription id="today-review-desc">
              Check each item's amount and nutrition. Answer any preparation
              questions, edit values if needed, then add them to your day.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {pending?.map((item, idx) => (
              <PendingRow
                key={idx}
                item={item}
                recalcing={recalcingRows.has(idx)}
                onRecalc={(next) => void recalcRow(idx, next)}
                onChange={(next) =>
                  {
                    editedRef.current = true;
                    setPending((p) => p!.map((it, i) => (i === idx ? next : it)));
                  }
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
                "Add to today"
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
        foodEntryId={reportTarget?.id ?? null}
        originalValues={reportTarget?.values ?? {}}
      />

      <Dialog open={!!demoImport} onOpenChange={(o) => !o && dismissDemoImport()}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Import your demo entries?</DialogTitle>
            <DialogDescription>
              We kept the {demoImport?.entries.length ?? 0}{" "}
              {demoImport?.entries.length === 1 ? "item" : "items"} you added while trying KainFit.
              Import them into today's log?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={importDemoEntries} className="w-full h-12 rounded-2xl">
              Yes, import them
            </Button>
            <Button variant="ghost" onClick={dismissDemoImport} className="w-full h-12 rounded-2xl">
              No thanks, start fresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}

function MacroPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold", color)}>
        {Math.round(value)}<span className="text-xs font-normal text-muted-foreground ml-0.5">g</span>
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
  const [showPrep, setShowPrep] = useState(prepClarification);
  useEffect(() => {
    if (prepClarification) setShowPrep(true);
  }, [prepClarification]);
  const prep = item.preparation;
  const prepNote =
    prep === "raw"
      ? "Calculated using raw weight."
      : prep === "cooked"
      ? "Calculated using cooked weight."
      : prep === "estimated"
      ? "Preparation estimated — using a middle-ground estimate. You can change this any time."
      : null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {item.clarification_needed && item.clarification_question && !prepClarification && (
        <div className="mb-3 rounded-xl bg-amber-brand/10 text-[oklch(0.4_0.16_75)] text-xs p-2">
          {item.clarification_question}
        </div>
      )}
      {showPrep && (
        <div className="mb-3 rounded-xl bg-amber-brand/10 p-2.5">
          <div className="text-xs font-medium text-[oklch(0.4_0.16_75)] mb-1.5">
            {prep === "raw" || prep === "cooked" || prep === "estimated"
              ? "Weighed raw or cooked?"
              : "Was that weighed raw or cooked?"}
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
          {prepNote && !recalcing && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">{prepNote}</div>
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
        <StatusBadge
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
          <Flag className="h-3 w-3" /> Report macros
        </button>
      </div>
    </div>
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

function StatusBadge({
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

function UserInitial() {
  const [initial, setInitial] = useState("K");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? "";
      const name = (data.user?.user_metadata as any)?.full_name ?? email;
      if (name) setInitial(String(name).charAt(0).toUpperCase());
    });
  }, []);
  return <>{initial}</>;
}