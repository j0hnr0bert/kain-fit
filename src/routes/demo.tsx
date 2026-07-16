import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import { ArrowLeft, ArrowUp, Sparkles, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

type DemoEntry = {
  id: string;
  meal: "breakfast" | "lunch" | "dinner" | "snacks";
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const SEED: DemoEntry[] = [
  { id: "d1", meal: "breakfast", name: "Tapa with garlic rice (sample)", quantity: "1 serving", calories: 520, protein: 28, carbs: 62, fat: 16 },
  { id: "d2", meal: "breakfast", name: "Fried egg (sample)", quantity: "1 pc", calories: 90, protein: 6, carbs: 1, fat: 7 },
  { id: "d3", meal: "lunch", name: "Chicken adobo (sample)", quantity: "150 g", calories: 320, protein: 32, carbs: 4, fat: 19 },
  { id: "d4", meal: "lunch", name: "Steamed rice (sample)", quantity: "200 g", calories: 260, protein: 5, carbs: 57, fat: 1 },
];

function DemoPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DemoEntry[]>(SEED);
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [signupPrompt, setSignupPrompt] = useState(false);

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
    const g: Record<DemoEntry["meal"], DemoEntry[]> = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    entries.forEach((e) => g[e.meal].push(e));
    return g;
  }, [entries]);

  function handleTry(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || parsing) return;
    setParsing(true);
    // Simulate a parse — never hits the network. Adds a clearly-labeled sample entry.
    setTimeout(() => {
      const now = new Date().getHours();
      const meal: DemoEntry["meal"] = now < 10 ? "breakfast" : now < 14 ? "lunch" : now < 20 ? "dinner" : "snacks";
      const sample: DemoEntry = {
        id: `d-${Date.now()}`,
        meal,
        name: `${input.trim()} (sample)`,
        quantity: "1 serving",
        calories: 250,
        protein: 14,
        carbs: 28,
        fat: 9,
      };
      setEntries((prev) => [...prev, sample]);
      setInput("");
      setParsing(false);
      toast.success("Added to demo (not saved)");
    }, 500);
  }

  function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function requireAccount() {
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
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="text-sm font-medium text-primary px-2 py-1"
          >
            Create account
          </Link>
        </div>

        {/* Demo banner */}
        <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-foreground">Demo mode</div>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              You're browsing sample data. Nothing here is saved to an account.
            </p>
          </div>
        </div>

        {/* Totals */}
        <div className="mt-5 rounded-3xl bg-card border border-border p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Today · sample</div>
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
              placeholder="Try: chicken adobo and rice"
              aria-label="Try a sample food entry"
              className="h-14 pl-5 pr-14 bg-transparent border-0 rounded-3xl text-base focus-visible:ring-0"
              disabled={parsing}
            />
            <button
              type="submit"
              disabled={parsing || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
              aria-label="Add sample entry"
            >
              {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Adds a clearly-labeled sample. Nothing leaves your device.
          </p>
        </form>

        {/* Log */}
        <div className="mt-6 space-y-6">
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
                        <div className="font-medium truncate">{e.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {e.quantity} · {e.calories} kcal · P {e.protein} · C {e.carbs} · F {e.fat}
                        </div>
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
            className={cn("w-full h-12 rounded-2xl")}
          >
            Save this day to my account
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            You'll be asked to create an account before anything is saved.
          </p>
        </div>
      </div>

      <Dialog open={signupPrompt} onOpenChange={setSignupPrompt}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Create an account to save</DialogTitle>
            <DialogDescription>
              Demo data stays on this device. Create a free KainFit account to keep your log and
              pick up where you left off on any device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full h-12 rounded-2xl"
              onClick={() => navigate({ to: "/auth", search: { mode: "signup" } })}
            >
              Create account
            </Button>
            <Button
              variant="ghost"
              className="w-full h-12 rounded-2xl"
              onClick={() => setSignupPrompt(false)}
            >
              Keep exploring the demo
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
