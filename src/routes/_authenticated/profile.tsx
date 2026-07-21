import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { LogOut, Download, MessageSquare, Shield, Lock, Scale as ScaleIcon } from "lucide-react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { BetaBadge } from "@/components/BetaBadge";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

type Units = "metric" | "imperial";
type Sex = "male" | "female" | "prefer_not_to_say";
type Activity =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active"
  | "extremely_active";

const ACTIVITY_OPTIONS: { value: Activity; label: string }[] = [
  { value: "sedentary", label: "Mostly seated" },
  { value: "light", label: "Lightly active" },
  { value: "moderate", label: "Moderately active" },
  { value: "very_active", label: "Very active" },
  { value: "extremely_active", label: "Extremely active" },
];

// Metric is the storage format. Imperial is a display-only preference.
const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}
function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}
function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}
function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
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
  const [units, setUnits] = useState<Units>("metric");
  const [detailsUpdatedAt, setDetailsUpdatedAt] = useState<string | null>(null);

  // Draft fields for the height/weight inputs (unit-aware, string-based).
  const [heightInput, setHeightInput] = useState("");
  const [weightInput, setWeightInput] = useState("");

  // Manual macro targets
  const [targetsEnabled, setTargetsEnabled] = useState(false);
  const [tCalories, setTCalories] = useState("");
  const [tProtein, setTProtein] = useState("");
  const [tCarbs, setTCarbs] = useState("");
  const [tFat, setTFat] = useState("");

  const [savingDetails, setSavingDetails] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

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
        setActivity(
          ACTIVITY_OPTIONS.some((o) => o.value === act) ? act : "moderate",
        );
        const u2 = (data.preferred_units as Units | null) ?? "metric";
        setUnits(u2 === "imperial" ? "imperial" : "metric");
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
        setTCalories(targets.target_calories != null ? String(targets.target_calories) : "");
        setTProtein(targets.target_protein_g != null ? String(targets.target_protein_g) : "");
        setTCarbs(targets.target_carbs_g != null ? String(targets.target_carbs_g) : "");
        setTFat(targets.target_fat_g != null ? String(targets.target_fat_g) : "");
      }
      const { data: roleRow } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (a: string, b: string) => {
              in: (a: string, b: string[]) => Promise<{ data: { role: string }[] | null }>;
            };
          };
        };
      })
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .in("role", ["admin", "founder"]);
      setIsAdmin(!!(roleRow && roleRow.length > 0));
      setLoaded(true);
    })();
  }, []);

  // Recompute unit-facing inputs whenever the underlying metric value or
  // the display unit changes.
  useEffect(() => {
    if (heightCm == null) {
      setHeightInput("");
    } else {
      setHeightInput(
        units === "metric"
          ? String(Math.round(heightCm * 10) / 10)
          : String(Math.round(cmToInches(heightCm) * 10) / 10),
      );
    }
  }, [heightCm, units]);
  useEffect(() => {
    if (weightKg == null) {
      setWeightInput("");
    } else {
      setWeightInput(
        units === "metric"
          ? String(Math.round(weightKg * 10) / 10)
          : String(Math.round(kgToLb(weightKg) * 10) / 10),
      );
    }
  }, [weightKg, units]);

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
        heightCmVal = units === "metric" ? raw : inchesToCm(raw);
        if (heightCmVal < 50 || heightCmVal > 260) {
          throw new Error("Height looks out of range.");
        }
        heightCmVal = Math.round(heightCmVal * 10) / 10;
      }

      let weightKgVal: number | null = null;
      if (weightInput.trim() !== "") {
        const raw = Number(weightInput);
        if (!Number.isFinite(raw) || raw <= 0) throw new Error("Weight must be a positive number.");
        weightKgVal = units === "metric" ? raw : lbToKg(raw);
        if (weightKgVal < 20 || weightKgVal > 500) {
          throw new Error("Weight looks out of range.");
        }
        weightKgVal = Math.round(weightKgVal * 10) / 10;
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
          preferred_units: units,
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

  async function saveTargets() {
    setSavingTargets(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const cal = Number(tCalories);
      const prot = Number(tProtein);
      const carb = Number(tCarbs);
      const fat = Number(tFat);
      if (!Number.isFinite(cal) || cal < 500 || cal > 10000) {
        throw new Error("Daily calories must be between 500 and 10,000.");
      }
      for (const [name, v] of [
        ["Protein", prot],
        ["Carbohydrates", carb],
        ["Fat", fat],
      ] as const) {
        if (!Number.isFinite(v) || v < 0 || v > 1000) {
          throw new Error(`${name} must be between 0 and 1,000 g.`);
        }
      }
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
    // Only enable when all four numbers are already filled in.
    const cal = Number(tCalories);
    const prot = Number(tProtein);
    const carb = Number(tCarbs);
    const fat = Number(tFat);
    if (
      !Number.isFinite(cal) ||
      !Number.isFinite(prot) ||
      !Number.isFinite(carb) ||
      !Number.isFinite(fat)
    ) {
      toast("Enter all four targets, then save.", { duration: 3000 });
      return;
    }
    await saveTargets();
  }

  async function exportHistory() {
    const { data, error } = await supabase.from("food_entries").select("*").order("logged_at");
    if (error) return toast.error(error.message);
    const rows = data ?? [];
    const headers = [
      "logged_at","meal_type","display_name","quantity","unit","calories",
      "protein_g","carbs_g","fat_g","data_source",
    ];
    const csv = [headers.join(",")]
      .concat(
        rows.map((r: Record<string, unknown>) =>
          headers.map((h) => JSON.stringify(r[h] ?? "")).join(","),
        ),
      )
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

  async function deleteAccount() {
    if (!confirm("Delete your account and all data? This cannot be undone.")) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("food_entries").delete().eq("user_id", u.user.id);
    await supabase.from("saved_foods").delete().eq("user_id", u.user.id);
    await supabase.from("profiles").delete().eq("user_id", u.user.id);
    await supabase.auth.signOut();
    toast("Account data deleted");
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
            <Label>Measurement system</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["metric", "imperial"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnits(u)}
                  className={
                    "h-10 rounded-xl border text-sm font-medium capitalize " +
                    (units === u
                      ? "border-primary bg-primary/5"
                      : "border-border text-muted-foreground")
                  }
                >
                  {u}
                </button>
              ))}
            </div>
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
              <Label htmlFor="wt">Weight ({units === "metric" ? "kg" : "lb"})</Label>
              <Input
                id="wt"
                inputMode="decimal"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="ht">Height ({units === "metric" ? "cm" : "in"})</Label>
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

          <Button onClick={saveDetails} disabled={savingDetails || !loaded} className="w-full h-11 rounded-2xl">
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
              Enter targets you already follow. KainFit will display them but will not recommend or
              adjust them.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="text-sm font-medium">Use manual macro targets</div>
            <Switch checked={targetsEnabled} onCheckedChange={toggleTargets} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tcal">Daily calories</Label>
              <Input
                id="tcal"
                inputMode="numeric"
                placeholder="e.g. 2000"
                value={tCalories}
                onChange={(e) => setTCalories(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
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
          <Button onClick={() => setFeedbackOpen(true)} variant="outline" className="w-full h-11 rounded-2xl justify-start">
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
          <Button onClick={exportHistory} variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <Download className="h-4 w-4 mr-2" /> Export food history (CSV)
          </Button>
          <Button onClick={signOut} variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
          <Button
            onClick={deleteAccount}
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
        anonymousSessionId={typeof window !== "undefined" ? (localStorage.getItem("kf.sid") ?? "") : ""}
      />
      <BottomNav />
    </div>
  );
}