import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const { start, end, key, label, isToday } = useMemo(() => {
    const s = new Date(date);
    const e = new Date(date);
    e.setDate(e.getDate() + 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      start: s.toISOString(),
      end: e.toISOString(),
      key: s.toISOString(),
      label: s.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      isToday: s.getTime() === today.getTime(),
    };
  }, [date]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["entries", "day", key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_entries")
        .select("*")
        .gte("logged_at", start)
        .lt("logged_at", end)
        .order("logged_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = entries.reduce(
    (a, e) => ({
      calories: a.calories + Number(e.calories),
      protein: a.protein + Number(e.protein_g),
      carbs: a.carbs + Number(e.carbs_g),
      fat: a.fat + Number(e.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  function shift(days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d);
  }

  async function del(id: string) {
    const { error } = await supabase.from("food_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["entries"] });
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <div
        className="max-w-md mx-auto px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <h1 className="text-2xl font-bold tracking-tight mb-4">History</h1>
        <div className="rounded-3xl bg-card border border-border p-4">
          <div className="flex items-center justify-between">
            <button onClick={() => shift(-1)} className="p-2 -ml-2 text-muted-foreground" aria-label="Previous day">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <div className="font-semibold">{label}</div>
              {isToday && <div className="text-xs text-primary">Today</div>}
            </div>
            <button
              onClick={() => shift(1)}
              disabled={isToday}
              className="p-2 -mr-2 text-muted-foreground disabled:opacity-30"
              aria-label="Next day"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <Stat label="kcal" value={totals.calories} />
            <Stat label="P" value={totals.protein} />
            <Stat label="C" value={totals.carbs} />
            <Stat label="F" value={totals.fat} />
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && entries.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Nothing logged this day.
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id} className="rounded-2xl bg-card border border-border p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{e.display_name}</div>
                <div className="text-xs text-muted-foreground">
                  {Number(e.quantity)}{e.unit} · {Math.round(Number(e.calories))} kcal · {e.meal_type}
                </div>
              </div>
              <button onClick={() => del(e.id)} className="p-2 text-muted-foreground" aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold">{Math.round(value)}</div>
    </div>
  );
}