import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

type Activity = "sedentary" | "light" | "moderate" | "very_active";
type Sex = "male" | "female" | "prefer_not_to_say";

function Onboarding() {
  const navigate = useNavigate();
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<Sex>("prefer_not_to_say");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<Activity>("moderate");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data?.onboarded) navigate({ to: "/today", replace: true });
    })();
  }, [navigate]);

  async function save() {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          age: age ? Number(age) : null,
          sex,
          height_cm: height ? Number(height) : null,
          weight_kg: weight ? Number(weight) : null,
          activity_level: activity,
          onboarded: true,
        })
        .eq("user_id", u.user.id);
      if (error) throw error;
      navigate({ to: "/today", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setLoading(false);
    }
  }

  async function skip() {
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      await supabase.from("profiles").update({ onboarded: true }).eq("user_id", u.user.id);
    }
    navigate({ to: "/today", replace: true });
  }

  const activityOptions: { key: Activity; label: string; desc: string }[] = [
    { key: "sedentary", label: "Sedentary", desc: "Little to no exercise" },
    { key: "light", label: "Lightly active", desc: "1–3 days a week" },
    { key: "moderate", label: "Moderately active", desc: "3–5 days a week" },
    { key: "very_active", label: "Very active", desc: "6–7 days a week" },
  ];

  const sexOptions: { key: Sex; label: string }[] = [
    { key: "male", label: "Male" },
    { key: "female", label: "Female" },
    { key: "prefer_not_to_say", label: "Prefer not to say" },
  ];

  return (
    <div className="min-h-[100dvh] bg-background px-6 pt-10 pb-10">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-1">A few quick details</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Saved to your profile for future personalization. KainFit will not assign calorie or macro targets.
        </p>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input id="age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input id="weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="height">Height (cm)</Label>
              <Input id="height" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className="h-12 rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sex</Label>
            <div className="grid grid-cols-3 gap-2">
              {sexOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setSex(o.key)}
                  className={`h-11 rounded-xl text-sm font-medium border transition ${sex === o.key ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Activity level</Label>
            <div className="space-y-2">
              {activityOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setActivity(o.key)}
                  className={`w-full text-left p-4 rounded-2xl border transition ${activity === o.key ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="text-xs text-muted-foreground">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <Button onClick={save} disabled={loading} className="w-full h-12 rounded-2xl">
              Continue
            </Button>
            <Button onClick={skip} variant="ghost" className="w-full h-12 rounded-2xl">
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}