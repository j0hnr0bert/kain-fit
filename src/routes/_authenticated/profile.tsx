import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogOut, Download, MessageSquare, Shield } from "lucide-react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { BetaBadge } from "@/components/BetaBadge";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<string>("prefer_not_to_say");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [activity, setActivity] = useState<string>("moderate");
  const [language, setLanguage] = useState<string>("auto");
  const [saving, setSaving] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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
        setAge(data.age ? String(data.age) : "");
        setSex(data.sex ?? "prefer_not_to_say");
        setHeightCm(data.height_cm ? String(data.height_cm) : "");
        setWeightKg(data.weight_kg ? String(data.weight_kg) : "");
        setActivity(data.activity_level ?? "moderate");
        setLanguage(data.preferred_language ?? "auto");
      }
      const { data: roleRow } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (a: string, b: string) => {
              eq: (a: string, b: string) => {
                maybeSingle: () => Promise<{ data: { role: string } | null }>;
              };
            };
          };
        };
      })
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!roleRow);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName || null,
          age: age ? Number(age) : null,
          sex,
          height_cm: heightCm ? Number(heightCm) : null,
          weight_kg: weightKg ? Number(weightKg) : null,
          activity_level: activity,
          preferred_language: language,
        })
        .eq("user_id", u.user.id);
      if (error) throw error;
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function exportHistory() {
    const { data, error } = await supabase.from("food_entries").select("*").order("logged_at");
    if (error) return toast.error(error.message);
    const rows = data ?? [];
    const headers = ["logged_at", "meal_type", "display_name", "quantity", "unit", "calories", "protein_g", "carbs_g", "fat_g", "data_source"];
    const csv = [headers.join(",")].concat(
      rows.map((r: any) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
    ).join("\n");
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

        <div className="rounded-3xl bg-card border border-border p-5 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Signed in as</Label>
            <div className="text-sm font-medium">{email || "—"}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input id="age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt">Weight (kg)</Label>
              <Input id="wt" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="ht">Height (cm)</Label>
              <Input id="ht" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className="h-11 rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sex</Label>
            <select value={sex} onChange={(e) => setSex(e.target.value)} className="w-full h-11 rounded-xl border border-input bg-background px-3">
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Activity level</Label>
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className="w-full h-11 rounded-xl border border-input bg-background px-3">
              <option value="sedentary">Sedentary</option>
              <option value="light">Lightly active</option>
              <option value="moderate">Moderately active</option>
              <option value="very_active">Very active</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Language preference</Label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full h-11 rounded-xl border border-input bg-background px-3">
              <option value="auto">Automatic</option>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </div>

          <Button onClick={save} disabled={saving} className="w-full h-11 rounded-2xl">
            Save changes
          </Button>
        </div>

        <div className="mt-4 rounded-3xl bg-card border border-border p-5 space-y-3">
          <Button onClick={() => setFeedbackOpen(true)} variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <MessageSquare className="h-4 w-4 mr-2" /> Send feedback
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" className="w-full h-11 rounded-2xl justify-start">
              <Link to="/admin/beta">
                <Shield className="h-4 w-4 mr-2" /> Beta dashboard
              </Link>
            </Button>
          )}
          <Button onClick={exportHistory} variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <Download className="h-4 w-4 mr-2" /> Export food history (CSV)
          </Button>
          <Button onClick={signOut} variant="outline" className="w-full h-11 rounded-2xl justify-start">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
          <Button onClick={deleteAccount} variant="ghost" className="w-full h-11 rounded-2xl justify-start text-destructive hover:text-destructive">
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