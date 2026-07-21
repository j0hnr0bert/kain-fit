import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sumNutrients } from "@/lib/nutrient-totals";
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
import { mark, elapsed } from "@/lib/perf";
import { BetaBadge } from "@/components/BetaBadge";
import { HighDemandBanner } from "@/components/HighDemandBanner";
import { ReportMacrosDialog } from "@/components/ReportMacrosDialog";
import { QuickLogRail } from "@/components/QuickLogRail";
import { formatQuantity, foodStatus, isPreparationClarification } from "@/lib/food-display";
import { getBetaUsage } from "@/lib/ops.functions";
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
  client_request_id?: string;
};

const MANILA_TIME_ZONE = "Asia/Manila";

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  const bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function stampClientRequestIds(items: PendingItem[]) {
  return items.map((item) => ({
    ...item,
    client_request_id: item.client_request_id ?? createUuid(),
  }));
}

function getManilaHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

function getManilaDayBounds(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const start = new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function formatDbError(error: {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}) {
  return [
    error.message || "Database save failed.",
    error.details ? `Details: ${error.details}` : null,
    error.hint ? `Hint: ${error.hint}` : null,
    error.code ? `Code: ${error.code}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
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
    savedAt: number;
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
      // Read from localStorage (survives OAuth redirect); also drain legacy
      // sessionStorage entries from older demo sessions.
      const raw =
        localStorage.getItem("kf.demoPendingImport") ??
        sessionStorage.getItem("kf.demoPendingImport");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        savedAt?: number;
        entries: Array<Record<string, unknown>>;
      };
      const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
      if (list.length === 0) {
        localStorage.removeItem("kf.demoPendingImport");
        sessionStorage.removeItem("kf.demoPendingImport");
        return;
      }
      setDemoImport({
        savedAt: typeof parsed?.savedAt === "number" ? parsed.savedAt : Date.now(),
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
    const loggedAt = new Date().toISOString();
    const rows = demoImport.entries.map((i, idx) => ({
      user_id: u.user!.id,
      logged_at: loggedAt,
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
      // Deterministic idempotency key derived from user + saved batch + index,
      // so retries/double-clicks after signup cannot insert the row twice.
      client_request_id: `demo:${u.user!.id}:${demoImport.savedAt}:${idx}`,
    }));
    const { error } = await supabase
      .from("food_entries")
      .upsert(rows, { onConflict: "client_request_id", ignoreDuplicates: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    try {
      localStorage.removeItem("kf.demoPendingImport");
      sessionStorage.removeItem("kf.demoPendingImport");
    } catch { /* ignore */ }
    setDemoImport(null);
    qc.invalidateQueries({ queryKey: ["entries", "today"] });
    toast.success(`Imported ${rows.length} demo ${rows.length === 1 ? "entry" : "entries"}`);
  }

  function dismissDemoImport() {
    try {
      localStorage.removeItem("kf.demoPendingImport");
      sessionStorage.removeItem("kf.demoPendingImport");
    } catch { /* ignore */ }
    setDemoImport(null);
  }

  useEffect(() => {
    markReturned();
  }, []);

  // Prefill / focus from the Food Scale Guide's "Try it on Today" button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const prefill = sessionStorage.getItem("kf.scalePrefill");
      const focus = sessionStorage.getItem("kf.scaleFocus");
      if (prefill) {
        setInput(prefill);
        sessionStorage.setItem("kf.scaleExamplePending", "1");
        sessionStorage.removeItem("kf.scalePrefill");
      }
      if (focus) {
        sessionStorage.removeItem("kf.scaleFocus");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } catch {
      /* ignore */
    }
  }, []);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["entries", "today"],
    queryFn: async () => {
      const { startIso, endIso } = getManilaDayBounds();
      const started = mark();
      const { data, error } = await supabase
        .from("food_entries")
        .select("*")
        .gte("logged_at", startIso)
        .lt("logged_at", endIso)
        .order("created_at", { ascending: false });
      const database_query_duration_ms = elapsed(started);
      if (error) throw error;
      track("today_ready", {
        database_query_duration_ms,
        entry_count: data?.length ?? 0,
      });
      return (data ?? []) as Entry[];
    },
  });

  async function saveFoodItems(
    items: PendingItem[],
    sourceInput: string,
    options: { automatic?: boolean } = {},
  ) {
    if (items.length === 0 || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const saveStarted = mark();
    try {
      const { data: u, error: authError } = await supabase.auth.getUser();
      if (authError || !u.user) {
        const msg = authError?.message ?? "Please sign in again before saving this meal.";
        setSaveError(msg);
        toast.error(msg);
        return false;
      }

      if (editedRef.current) track("food_edited_before_confirmation", { number_of_items: items.length });
      const loggedAt = new Date().toISOString();
      const stampedItems = stampClientRequestIds(items);
      const rows = stampedItems.map((i) => ({
        user_id: u.user!.id,
        logged_at: loggedAt,
        meal_type: i.meal_type,
        original_input: sourceInput,
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
        client_request_id: i.client_request_id,
      }));

      const { data, error } = await supabase.from("food_entries").insert(rows).select("*");
      const database_query_duration_ms = elapsed(saveStarted);
      if (error) {
        if (error.code === "23505") {
          const ids = stampedItems
            .map((item) => item.client_request_id)
            .filter((id): id is string => Boolean(id));
          const { data: existingRows, error: lookupError } = await supabase
            .from("food_entries")
            .select("*")
            .in("client_request_id", ids);
          if (!lookupError && (existingRows?.length ?? 0) >= rows.length) {
            const existing = (existingRows ?? []) as Entry[];
            qc.setQueryData<Entry[]>(["entries", "today"], (current = []) => {
              const known = new Set(current.map((entry) => entry.id));
              return [...existing.filter((entry) => !known.has(entry.id)), ...current].sort(
                (a, b) =>
                  new Date(b.created_at ?? b.logged_at).getTime() -
                  new Date(a.created_at ?? a.logged_at).getTime(),
              );
            });
            setPending(null);
            setInput("");
            await qc.invalidateQueries({ queryKey: ["entries", "today"] });
            await qc.invalidateQueries({ queryKey: ["beta-usage"] });
            toast.success("Added to Today");
            return true;
          }
        }

        const msg = formatDbError(error);
        console.error("[today] food_entries insert failed", { error, rows });
        setSaveError(msg);
        toast.error(msg, { duration: 9000 });
        return false;
      }

      const savedRows = (data ?? []) as Entry[];
      if (savedRows.length !== rows.length) {
        const msg = `Saved ${savedRows.length} of ${rows.length} items. Please retry.`;
        console.error("[today] food_entries insert returned unexpected row count", { savedRows, rows });
        setSaveError(msg);
        toast.error(msg);
        await qc.invalidateQueries({ queryKey: ["entries", "today"] });
        return false;
      }

      qc.setQueryData<Entry[]>(["entries", "today"], (current = []) => {
        const known = new Set(current.map((entry) => entry.id));
        return [...savedRows.filter((entry) => !known.has(entry.id)), ...current].sort(
          (a, b) =>
            new Date(b.created_at ?? b.logged_at).getTime() -
            new Date(a.created_at ?? a.logged_at).getTime(),
        );
      });
      track("food_confirmed", {
        number_of_items: rows.length,
        save_mode: options.automatic ? "automatic" : "manual",
      });
      try {
        const flagKey = "kf.firstFoodLogged";
        if (typeof window !== "undefined" && !localStorage.getItem(flagKey)) {
          localStorage.setItem(flagKey, "1");
          track("first_food_logged", {
            number_of_items: rows.length,
            save_mode: options.automatic ? "automatic" : "manual",
          });
        }
      } catch { /* ignore */ }
      track("food_log_saved", {
        number_of_items: rows.length,
        save_mode: options.automatic ? "automatic" : "manual",
        food_log_total_duration_ms: elapsed(saveStarted),
        database_query_duration_ms,
      });
      setPending(null);
      setInput("");
      toast.success("Added to Today", {
        duration: options.automatic ? 5000 : 3000,
        action: options.automatic
          ? {
              label: "Undo",
              onClick: async () => {
                const ids = savedRows.map((row) => row.id);
                if (ids.length === 0) return;
                const { error: undoError } = await supabase.from("food_entries").delete().in("id", ids);
                if (undoError) {
                  toast.error(formatDbError(undoError));
                  return;
                }
                await qc.invalidateQueries({ queryKey: ["entries", "today"] });
                toast("Meal removed");
              },
            }
          : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["entries", "today"] });
      await qc.invalidateQueries({ queryKey: ["beta-usage"] });
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Manual macro targets — private to this user; never sent to gym owners.
  const { data: profile } = useQuery({
    queryKey: ["profile", "targets"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("manual_targets_enabled,target_calories,target_protein_g,target_carbs_g,target_fat_g")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return data as {
        manual_targets_enabled: boolean;
        target_calories: number | null;
        target_protein_g: number | null;
        target_carbs_g: number | null;
        target_fat_g: number | null;
      } | null;
    },
  });
  const targetsActive = Boolean(
    profile?.manual_targets_enabled &&
      profile.target_calories &&
      profile.target_protein_g !== null &&
      profile.target_carbs_g !== null &&
      profile.target_fat_g !== null,
  );

  // Server-authoritative beta submission usage.
  const fetchBetaUsage = useServerFn(getBetaUsage);
  const { data: betaUsage } = useQuery({
    queryKey: ["beta-usage"],
    queryFn: () => fetchBetaUsage(),
    refetchInterval: 60_000,
    retry: false,
  });
  // Refresh usage after each successful add.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["beta-usage"] });
  }, [entries.length, qc]);

  const totals = useMemo(() => sumNutrients(entries), [entries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || parsing) return;
    if (betaUsage?.reachedLimit) {
      toast.error(
        "You've reached today's beta limit. Your allowance resets at midnight. Existing entries can still be edited.",
      );
      return;
    }
    setParsing(true);
    setOriginalInput(input);
    editedRef.current = false;
    const started = performance.now();
    track("food_submitted", {});
    track("food_calculation_started", { source: "authenticated" });
    const highDemandTimer = window.setTimeout(() => {
      toast("Demand is unusually high — hang tight.", { duration: 6000 });
    }, 10_000);
    try {
      const mealHint = mealFromHour(getManilaHour());
      const result = await parseFn({ data: { input, mealHint } });
      const dur = Math.round(performance.now() - started);
      const cacheHit = result.timings?.cache_hit === true;
      track(cacheHit ? "cache_hit" : "cache_miss", {
        resolution_path: result.timings?.resolution_path ?? null,
        ai_request_duration_ms: result.timings?.ai_parsing_ms ?? null,
      });
      track("food_calculation_completed", {
        source: "authenticated",
        total_duration_ms: dur,
        ai_request_duration_ms: result.timings?.ai_parsing_ms ?? null,
        resolution_path: result.timings?.resolution_path ?? null,
        cache_hit: cacheHit,
        number_of_items: result.items.length,
      });
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
        const stampedItems = stampClientRequestIds(result.items);
        if (anyClar) {
          track("food_clarification_requested", { number_of_items: result.items.length });
          setPending(stampedItems);
        } else {
          const saved = await saveFoodItems(stampedItems, input, { automatic: true });
          if (!saved) setPending(stampedItems);
        }
      }
    } catch (err) {
      track("food_parse_failed", {
        processing_duration_ms: Math.round(performance.now() - started),
        reason: err instanceof Error ? err.message.slice(0, 80) : "unknown",
      });
      const msg = err instanceof Error ? err.message : "Could not parse. Try again.";
      if (msg.startsWith("BETA_LIMIT:")) {
        toast.error(msg.replace(/^BETA_LIMIT:\s*/, ""));
        qc.invalidateQueries({ queryKey: ["beta-usage"] });
      } else if (msg.startsWith("AI_UNAVAILABLE:")) {
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
    await saveFoodItems(pending, originalInput);
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
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {targetsActive ? "Your manual targets" : "Today"}
            </div>
            {targetsActive && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                You entered these
              </div>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="text-5xl font-bold tracking-tight">{Math.round(totals.calories)}</div>
            <div className="text-sm text-muted-foreground">
              {targetsActive ? `/ ${profile!.target_calories} kcal` : "kcal"}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <MacroPill
              label="Protein"
              value={totals.protein}
              target={targetsActive ? profile!.target_protein_g : null}
              color="text-primary"
            />
            <MacroPill
              label="Carbs"
              value={totals.carbs}
              target={targetsActive ? profile!.target_carbs_g : null}
              color="text-[oklch(0.72_0.19_145)]"
            />
            <MacroPill
              label="Fat"
              value={totals.fat}
              target={targetsActive ? profile!.target_fat_g : null}
              color="text-[oklch(0.68_0.17_25)]"
            />
          </div>
        </div>
        {betaUsage?.enabled && betaUsage.cap > 0 && (
          betaUsage.reachedLimit ? (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              You've reached today's beta limit. Your allowance resets at midnight. Existing entries can still be edited.
            </div>
          ) : betaUsage.remaining !== null && betaUsage.remaining <= 5 ? (
            <div className="mt-3 text-[11px] text-muted-foreground px-1">
              {betaUsage.remaining} beta {betaUsage.remaining === 1 ? "entry" : "entries"} remaining today
            </div>
          ) : null
        )}

        {/* Entry */}
        <form onSubmit={handleSubmit} className="mt-5">
          <QuickLogRail todaysEntries={entries} />
          <div className="relative rounded-3xl bg-card border border-border shadow-sm focus-within:border-primary transition mt-5">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your next food or meal…"
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
            Try: <span className="text-foreground/80">{placeholderExamples[placeholderIdx]}</span>
          </p>
          <div className="mt-1 px-1">
            <Link
              to="/scale-guide"
              search={{ from: "today_help" as const }}
              className="text-xs text-primary hover:underline"
            >
              Use a food scale →
            </Link>
          </div>
        </form>

        {/* Log */}
        <div className="mt-8">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 px-1">
            Today's Log
          </div>
          {isLoading && (
            <div className="text-sm text-muted-foreground">Loading today's log…</div>
          )}
          {!isLoading && entries.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nothing logged yet. Type what you ate above.
            </div>
          )}
          <div className="space-y-2">
            {entries.map((e) => (
              <SwipeableEntry
                key={e.id}
                onDelete={() => deleteEntry(e)}
                onOpen={() => setEditingEntry(e)}
              >
                <div className="rounded-2xl bg-card border border-border p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{e.display_name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatEntryTime(e.created_at ?? e.logged_at)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <StatusBadge
                      data_source={e.data_source}
                      is_estimate={e.is_estimate}
                      preparation={e.preparation ?? null}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatQuantity(e.quantity, e.unit)} · {Math.round(e.calories)} kcal ·
                    P {Math.round(e.protein_g)} · C {Math.round(e.carbs_g)} · F {Math.round(e.fat_g)}
                  </div>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
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
                      });
                    }}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Flag className="h-3 w-3" /> Report incorrect macros
                  </button>
                </div>
              </SwipeableEntry>
            ))}
          </div>
        </div>
      </div>

      {/* Review sheet */}
      <Sheet
        open={!!pending}
        onOpenChange={(o) => {
          if (saving) return;
          if (!o) {
            setPending(null);
            setSaveError(null);
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
          {saveError && (
            <div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {saveError}
            </div>
          )}
          <div className="mt-6 space-y-2">
            <Button
              onClick={confirmAdd}
              disabled={anyRecalcing || saving}
              className="w-full h-12 rounded-2xl"
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </span>
              ) : anyRecalcing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Recalculating…
                </span>
              ) : (
                saveError ? "Retry save" : "Add to Today"
              )}
            </Button>
            <Button
              onClick={() => {
                setSaveError(null);
                setPending(null);
              }}
              disabled={saving}
              variant="ghost"
              className="w-full h-12 rounded-2xl"
            >
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

      <EditEntrySheet
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSave={async (qty) => {
          if (!editingEntry) return false;
          const ok = await updateEntryAmount(editingEntry, qty);
          if (ok) setEditingEntry(null);
          return ok;
        }}
        onDelete={async () => {
          if (!editingEntry) return;
          const e = editingEntry;
          setEditingEntry(null);
          await deleteEntry(e);
        }}
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

function MacroPill({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target?: number | null;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold", color)}>
        {Math.round(value)}
        {target != null ? (
          <span className="text-xs font-normal text-muted-foreground ml-0.5">
            / {target}g
          </span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground ml-0.5">g</span>
        )}
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

function SwipeableEntry({
  children,
  onDelete,
  onOpen,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const moved = useRef(false);
  const horiz = useRef(false);

  const REVEAL = 88; // px width of delete action

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    moved.current = false;
    horiz.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current == null || startY.current == null) return;
    const t = e.touches[0];
    const deltaX = t.clientX - startX.current;
    const deltaY = t.clientY - startY.current;
    if (!horiz.current) {
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        horiz.current = true;
      } else if (Math.abs(deltaY) > 8) {
        // vertical scroll — bail out
        startX.current = null;
        return;
      }
    }
    if (horiz.current) {
      moved.current = true;
      const base = open ? -REVEAL : 0;
      const next = Math.min(0, Math.max(-REVEAL * 1.4, base + deltaX));
      setDx(next);
    }
  }
  function onTouchEnd() {
    if (horiz.current) {
      if (dx < -REVEAL / 2) {
        setDx(-REVEAL);
        setOpen(true);
      } else {
        setDx(0);
        setOpen(false);
      }
    }
    startX.current = null;
    startY.current = null;
  }
  function handleClick() {
    if (moved.current) return;
    if (open) {
      setOpen(false);
      setDx(0);
      return;
    }
    onOpen();
  }
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
          setOpen(false);
          setDx(0);
        }}
        className="absolute inset-y-0 right-0 w-[88px] bg-destructive text-destructive-foreground flex items-center justify-center gap-1 text-sm font-medium"
        aria-label="Delete entry"
        tabIndex={open ? 0 : -1}
      >
        <Trash2 className="h-4 w-4" /> Delete
      </button>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
        style={{
          transform: `translateX(${dx}px)`,
          transition: startX.current == null ? "transform 0.2s ease" : "none",
        }}
        className="relative bg-background cursor-pointer"
      >
        {children}
      </div>
    </div>
  );
}

function EditEntrySheet({
  entry,
  onClose,
  onSave,
  onDelete,
}: {
  entry: Entry | null;
  onClose: () => void;
  onSave: (qty: number) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [qty, setQty] = useState<string>("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (entry) setQty(String(entry.quantity));
  }, [entry]);
  const unitLabel = useMemo(() => {
    if (!entry) return "";
    const u = (entry.unit ?? "").toLowerCase();
    if (u === "g") return "grams";
    if (u === "kg") return "kilograms";
    if (u === "ml") return "milliliters";
    if (u === "l") return "liters";
    return entry.unit || "units";
  }, [entry]);
  const parsed = Number(qty);
  const validationError =
    qty.trim() === "" || Number.isNaN(parsed)
      ? "Enter an amount."
      : parsed <= 0
      ? "Amount must be greater than 0."
      : parsed > 100000
      ? "That amount looks too large."
      : null;
  return (
    <Sheet open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{entry?.display_name}</SheetTitle>
          <SheetDescription>
            Adjust the amount. Nutrition recalculates instantly from the stored per-{unitLabel.replace(/s$/, "") || "unit"} values — no new AI calculation is used.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">Amount ({unitLabel})</span>
            <Input
              type="number"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 h-12 rounded-2xl text-lg"
              autoFocus
            />
            {validationError && (
              <span className="mt-1 block text-[11px] text-destructive">{validationError}</span>
            )}
          </label>
          {entry && (
            <div className="rounded-2xl bg-muted/60 p-3 text-xs text-muted-foreground">
              Current: {formatQuantity(entry.quantity, entry.unit)} · {Math.round(entry.calories)} kcal ·
              P {Math.round(entry.protein_g)} · C {Math.round(entry.carbs_g)} · F {Math.round(entry.fat_g)}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-12 rounded-2xl"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 h-12 rounded-2xl"
              disabled={saving || validationError !== null || Number(qty) === entry?.quantity}
              onClick={async () => {
                setSaving(true);
                await onSave(Number(qty));
                setSaving(false);
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>
          <div className="pt-4 border-t border-border">
            <Button
              variant="destructive"
              className="w-full h-12 rounded-2xl"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onDelete();
                setSaving(false);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete entry
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}