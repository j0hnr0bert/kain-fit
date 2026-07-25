import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  LogOut,
  Download,
  MessageSquare,
  Shield,
  Lock,
  Loader2,
  Scale as ScaleIcon,
} from "lucide-react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { BetaBadge } from "@/components/BetaBadge";
import { deleteOwnAccount } from "@/lib/account.functions";
import { deriveCaloriesFromMacros } from "@/lib/target-consistency";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

type Sex = "male" | "female" | "prefer_not_to_say";
type Activity = "sedentary" | "light" | "moderate" | "very_active" | "extremely_active";

const ACTIVITY_OPTIONS: { value: Activity; label: string }[] = [
  { value: "sedentary", label: "Mostly seated" },
  { value: "light", label: "Lightly active" },
  { value: "moderate", label: "Moderately active" },
  { value: "very_active", label: "Very active" },
  { value: "extremely_active", label: "Extremely active" },
];

// Numbers/plain text pass through unquoted; only quote+escape a cell when
// it actually needs it. Fixes exported numeric columns opening as text
// (e.g. "150" instead of 150) in spreadsheet apps.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  if (/[",\n]/.test(s)) return `"${s}"`;
  return s;
}

function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Personal details (metric-stored, display-only unit conversion)
  const [sex, setSex] = useState<Sex>("prefer_not_to_say");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [activity, setActivity] = useState<Activity>("moderate");
  const [detailsUpdatedAt, setDetailsUpdatedAt] = useState<string | null>(null);

  // Draft fields for the height/weight inputs (unit-aware, string-based).
  const [heightInput, setHeightInput] = useState("");
  const [weightInput, setWeightInput] = useState("");

  // Manual macro targets. Calories are read-only, derived from
  // protein/carbs/fat via deriveCaloriesFromMacros — see the memo below —
  // so there is no tCalories input state; a stored calorie value can never
  // disagree with its macros because the app never accepts one typed
  // independently.
  const [targetsEnabled, setTargetsEnabled] = useState(false);
  const [tProtein, setTProtein] = useState("");
  const [tCarbs, setTCarbs] = useState("");
  const [tFat, setTFat] = useState("");

  const [savingDetails, setSavingDetails] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  // Synchronous re-entrancy guard (2026-07-26 manual verification finding):
  // savingTargets alone doesn't prevent a rapid double-tap/duplicate submit,
  // because React batches the re-render that would disable the button, so
  // several clicks can fire before the DOM actually reflects
  // savingTargets=true. A ref is checked and set synchronously, before any
  // state update or await, so re-entrant calls are blocked immediately
  // regardless of render timing. savingTargets itself is kept for the
  // visual disabled state.
  const savingTargetsInFlightRef = useRef(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const deleteAccountFn = useServerFn(deleteOwnAccount);

  // Derived, never stored as separately-typed input. Rounded once here for
  // both display and save, so what the user sees is exactly what gets
  // written to target_calories.
  const derivedCalories = useMemo(
    () =>
      Math.round(
        deriveCaloriesFromMacros(Number(tProtein) || 0, Number(tCarbs) || 0, Number(tFat) || 0),
      ),
    [tProtein, tCarbs, tFat],
  );

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data) {
        setDisplayName(data.display_name ?? "");
        setSex((data.sex as Sex) ?? "prefer_not_to_say");
        setAge(data.age != null ? String(data.age) : "");
        setHeightCm(data.height_cm != null ? Number(data.height_cm) : null);
        setWeightKg(data.weight_kg != null ? Number(data.weight_kg) : null);
        const act = (data.activity_level ?? "moderate") as Activity;
        setActivity(ACTIVITY_OPTIONS.some((o) => o.value === act) ? act : "moderate");
        setDetailsUpdatedAt(
          (data as unknown as { profile_details_updated_at?: string | null })
            .profile_details_updated_at ?? null,
        );

        const targets = data as unknown as {
          manual_targets_enabled?: boolean | null;
          target_calories?: number | null;
          target_protein_g?: number | null;
          target_carbs_g?: number | null;
          target_fat_g?: number | null;
        };
        setTargetsEnabled(Boolean(targets.manual_targets_enabled));
        // target_calories itself is not loaded into editable state — it's
        // always re-derived from protein/carbs/fat (see derivedCalories
        // above), never read back as an independent value.
        setTProtein(targets.target_protein_g != null ? String(targets.target_protein_g) : "");
        setTCarbs(targets.target_carbs_g != null ? String(targets.target_carbs_g) : "");
        setTFat(targets.target_fat_g != null ? String(targets.target_fat_g) : "");
      }
      const { data: roleRow } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (
                a: string,
                b: string,
              ) => {
                in: (a: string, b: string[]) => Promise<{ data: { role: string }[] | null }>;
              };
            };
          };
        }
      )
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .in("role", ["admin", "founder"]);
      setIsAdmin(!!(roleRow && roleRow.length > 0));
      setLoaded(true);
    })();
  }, []);

  // Recompute the display input whenever the underlying stored value changes.
  useEffect(() => {
    setHeightInput(heightCm == null ? "" : String(Math.round(heightCm * 10) / 10));
  }, [heightCm]);
  useEffect(() => {
    setWeightInput(weightKg == null ? "" : String(Math.round(weightKg * 10) / 10));
  }, [weightKg]);

  const detailsUpdatedLabel = useMemo(() => {
    if (!detailsUpdatedAt) return null;
    try {
      return new Date(detailsUpdatedAt).toLocaleDateString();
    } catch {
      return null;
    }
  }, [detailsUpdatedAt]);

  async function saveDetails() {
    setSavingDetails(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;

      // Parse numeric fields with broad validation.
      const ageNum = age === "" ? null : Number(age);
      if (ageNum !== null && (!Number.isFinite(ageNum) || ageNum < 1 || ageNum > 120)) {
        throw new Error("Age must be between 1 and 120.");
      }

      let heightCmVal: number | null = null;
      if (heightInput.trim() !== "") {
        const raw = Number(heightInput);
        if (!Number.isFinite(raw) || raw <= 0) throw new Error("Height must be a positive number.");
        if (raw < 50 || raw > 260) {
          throw new Error("Height looks out of range.");
        }
        heightCmVal = Math.round(raw * 10) / 10;
      }

      let weightKgVal: number | null = null;
      if (weightInput.trim() !== "") {
        const raw = Number(weightInput);
        if (!Number.isFinite(raw) || raw <= 0) throw new Error("Weight must be a positive number.");
        if (raw < 20 || raw > 500) {
          throw new Error("Weight looks out of range.");
        }
        weightKgVal = Math.round(raw * 10) / 10;
      }

      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName || null,
          sex,
          age: ageNum,
          height_cm: heightCmVal,
          weight_kg: weightKgVal,
          activity_level: activity,
          profile_details_updated_at: nowIso,
        } as never)
        .eq("user_id", u.user.id);
      if (error) throw error;
      setHeightCm(heightCmVal);
      setWeightKg(weightKgVal);
      setDetailsUpdatedAt(nowIso);
      qc.invalidateQueries({ queryKey: ["profile", "targets"] });
      toast.success("Personal details saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSavingDetails(false);
    }
  }

  // The actual write — never called directly from the UI. Reached either
  // when the entered targets are internally consistent, or after the user
  // explicitly confirms "Keep targets" on a mismatch they were shown.
  // Never modifies any of the four values itself.
  async function performSaveTargets(cal: number, prot: number, carb: number, fat: number) {
    setSavingTargets(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          manual_targets_enabled: true,
          target_calories: Math.round(cal),
          target_protein_g: Math.round(prot),
          target_carbs_g: Math.round(carb),
          target_fat_g: Math.round(fat),
        } as never)
        .eq("user_id", u.user.id);
      if (error) throw error;
      setTargetsEnabled(true);
      qc.invalidateQueries({ queryKey: ["profile", "targets"] });
      toast.success("Manual targets saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save targets");
    } finally {
      setSavingTargets(false);
    }
  }

  // Calories are never taken as input here — always deriveCaloriesFromMacros
  // on the just-validated protein/carbs/fat, then range-checked against the
  // same 500–10,000 bound the database enforces (target_calories_range in
  // the profiles table), so an extreme macro combination fails validation
  // here with a clear message instead of failing at the database with a
  // generic error. This is what makes a stale/disagreeing stored calorie
  // value structurally impossible: the app never writes any calorie number
  // except this exact derivation.
  async function saveTargets() {
    // Synchronous check-and-set, before any validation or state update —
    // see savingTargetsInFlightRef's declaration for why this can't be
    // savingTargets state alone.
    if (savingTargetsInFlightRef.current) return;
    savingTargetsInFlightRef.current = true;
    try {
      const prot = Number(tProtein);
      const carb = Number(tCarbs);
      const fat = Number(tFat);
      for (const [name, v] of [
        ["Protein", prot],
        ["Carbohydrates", carb],
        ["Fat", fat],
      ] as const) {
        if (!Number.isFinite(v) || v < 0 || v > 1000) {
          toast.error(`${name} must be between 0 and 1,000 g.`);
          return;
        }
      }
      const cal = Math.round(deriveCaloriesFromMacros(prot, carb, fat));
      if (cal < 500 || cal > 10000) {
        toast.error(
          `These macros work out to ${cal.toLocaleString("en-US")} calories, outside the allowed 500–10,000 range. Adjust protein, carbs, or fat.`,
        );
        return;
      }

      await performSaveTargets(cal, prot, carb, fat);
    } finally {
      savingTargetsInFlightRef.current = false;
    }
  }

  async function toggleTargets(next: boolean) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    // Toggling off just hides the display. We keep the stored numbers so
    // switching back on doesn't require re-entering them.
    if (!next) {
      const { error } = await supabase
        .from("profiles")
        .update({ manual_targets_enabled: false } as never)
        .eq("user_id", u.user.id);
      if (error) return toast.error(error.message);
      setTargetsEnabled(false);
      qc.invalidateQueries({ queryKey: ["profile", "targets"] });
      return;
    }
    // Only enable when all three macro inputs are already filled in —
    // calories are derived, so there's nothing to check for that field.
    const prot = Number(tProtein);
    const carb = Number(tCarbs);
    const fat = Number(tFat);
    if (!Number.isFinite(prot) || !Number.isFinite(carb) || !Number.isFinite(fat)) {
      toast("Enter protein, carbs, and fat, then save.", { duration: 3000 });
      return;
    }
    await saveTargets();
  }

  async function exportHistory() {
    const { data, error } = await supabase.from("food_entries").select("*").order("logged_at");
    if (error) return toast.error(error.message);
    const rows = data ?? [];
    const headers = [
      "logged_at",
      "meal_type",
      "display_name",
      "quantity",
      "unit",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "data_source",
    ];
    const csv = [headers.join(",")]
      .concat(rows.map((r: Record<string, unknown>) => headers.map((h) => csvCell(r[h])).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kainfit-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
  }

  async function confirmDeleteAccount() {
    setDeletingAccount(true);
    try {
      await deleteAccountFn();
    } catch (err) {
      setDeletingAccount(false);
      toast.error(err instanceof Error ? err.message : "Could not delete your account.");
      return;
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Your account and data have been deleted.");
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <div
        className="max-w-md mx-auto px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <BetaBadge />
        </div>

        {/* Account */}
        <div className="rounded-3xl bg-card border border-border p-5 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Signed in as</Label>
            <div className="text-sm font-medium">{email || "—"}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dn">Display name</Label>
            <Input
              id="dn"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        {/* Personal Details */}
        <div className="mt-4 rounded-3xl bg-card border border-border p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Personal Details
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Optional information for your KainFit profile. These details are not currently used to
              create recommendations.
            </p>
          </div>

          <div className="rounded-xl bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground flex gap-2 items-start">
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Your personal details are private and are not shared with your gym. KainFit is not
              currently using them to generate nutrition advice.
            </span>
          </div>

          <div className="space-y-2">
            <Label>Sex</Label>
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value as Sex)}
              className="w-full h-11 rounded-xl border border-input bg-background px-3"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt">Weight (kg)</Label>
              <Input
                id="wt"
                inputMode="decimal"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="ht">Height (cm)</Label>
              <Input
                id="ht"
                inputMode="decimal"
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Activity level</Label>
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value as Activity)}
              className="w-full h-11 rounded-xl border border-input bg-background px-3"
            >
              {ACTIVITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={saveDetails}
            disabled={savingDetails || !loaded}
            className="w-full h-11 rounded-2xl"
          >
            {savingDetails ? "Saving…" : "Save personal details"}
          </Button>
          {detailsUpdatedLabel && (
            <p className="text-[11px] text-muted-foreground px-1">
              Last updated {detailsUpdatedLabel}
            </p>
          )}
        </div>

        {/* Manual Macro Targets */}
        <div className="mt-4 rounded-3xl bg-card border border-border p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Manual Macro Targets
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Enter the protein, carbs, and fat targets you already follow. KainFit will display
              them but will not recommend or adjust them. Daily calories are calculated from these
              three — protein × 4 + carbs × 4 + fat × 9 — and can't be edited directly.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="text-sm font-medium">Use manual macro targets</div>
            <Switch checked={targetsEnabled} onCheckedChange={toggleTargets} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tcal">Daily calories (calculated)</Label>
              <Input
                id="tcal"
                inputMode="numeric"
                value={derivedCalories}
                disabled
                readOnly
                aria-readonly="true"
                aria-live="polite"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tprot">Protein (g)</Label>
              <Input
                id="tprot"
                inputMode="numeric"
                placeholder="e.g. 150"
                value={tProtein}
                onChange={(e) => setTProtein(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tcarb">Carbs (g)</Label>
              <Input
                id="tcarb"
                inputMode="numeric"
                placeholder="e.g. 220"
                value={tCarbs}
                onChange={(e) => setTCarbs(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tfat">Fat (g)</Label>
              <Input
                id="tfat"
                inputMode="numeric"
                placeholder="e.g. 70"
                value={tFat}
                onChange={(e) => setTFat(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={saveTargets}
              disabled={savingTargets || !loaded}
              className="flex-1 h-11 rounded-2xl"
            >
              {savingTargets ? "Saving…" : "Save targets"}
            </Button>
            {targetsEnabled && (
              <Button
                variant="outline"
                onClick={() => toggleTargets(false)}
                className="h-11 rounded-2xl"
              >
                Turn off
              </Button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 rounded-3xl bg-card border border-border p-5 space-y-3">
          <Button
            onClick={() => setFeedbackOpen(true)}
            variant="outline"
            className="w-full h-11 rounded-2xl justify-start"
          >
            <MessageSquare className="h-4 w-4 mr-2" /> Send feedback
          </Button>
          <Button asChild variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <Link to="/scale-guide" search={{ from: "profile_help" as const }}>
              <ScaleIcon className="h-4 w-4 mr-2" /> Food scale guide
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" className="w-full h-11 rounded-2xl justify-start">
              <Link to="/admin/beta">
                <Shield className="h-4 w-4 mr-2" /> Founder dashboard
              </Link>
            </Button>
          )}
          <Button
            onClick={exportHistory}
            variant="outline"
            className="w-full h-11 rounded-2xl justify-start"
          >
            <Download className="h-4 w-4 mr-2" /> Export food history (CSV)
          </Button>
          <Button
            onClick={signOut}
            variant="outline"
            className="w-full h-11 rounded-2xl justify-start"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
          <Button
            onClick={() => setDeleteDialogOpen(true)}
            variant="ghost"
            className="w-full h-11 rounded-2xl justify-start text-destructive hover:text-destructive"
          >
            Delete account
          </Button>
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground leading-relaxed px-1">
          KainFit provides nutrition estimates for personal tracking and informational purposes.
          Values may vary based on ingredients, preparation, and serving size.
        </p>
      </div>
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        anonymousSessionId={
          typeof window !== "undefined" ? (localStorage.getItem("kf.sid") ?? "") : ""
        }
      />
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(o) => {
          if (!deletingAccount) setDeleteDialogOpen(o);
        }}
      >
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, food history, saved foods, and saved meals.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={confirmDeleteAccount}
              disabled={deletingAccount}
              className="w-full h-12 rounded-2xl"
            >
              {deletingAccount ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                </span>
              ) : (
                "Yes, delete my account"
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deletingAccount}
              className="w-full h-12 rounded-2xl"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BottomNav />
    </div>
  );
}
