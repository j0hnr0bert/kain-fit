import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

type Activity = "sedentary" | "light" | "moderate" | "very_active";
type Sex = "male" | "female" | "prefer_not_to_say";

const TOTAL_STEPS = 6;

function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex | null>(null);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (data?.onboarded) {
        navigate({ to: "/today", replace: true });
        return;
      }
      setReady(true);
    })();
  }, [navigate]);

  const progress = useMemo(() => ((step + 1) / TOTAL_STEPS) * 100, [step]);

  function next() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function finish() {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          age: age ? Number(age) : null,
          sex: sex ?? "prefer_not_to_say",
          height_cm: height ? Number(height) : null,
          weight_kg: weight ? Number(weight) : null,
          activity_level: activity ?? "moderate",
          onboarded: true,
        })
        .eq("user_id", u.user.id);
      if (error) throw error;
      navigate({ to: "/today", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
      setSaving(false);
    }
  }

  async function skipAll() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      await supabase.from("profiles").update({ onboarded: true }).eq("user_id", u.user.id);
    }
    navigate({ to: "/today", replace: true });
  }

  if (!ready) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  const canAdvance =
    step === 0 ? true :
    step === 1 ? sex !== null :
    step === 2 ? age !== "" && Number(age) > 0 :
    step === 3 ? height !== "" && Number(height) > 0 && weight !== "" && Number(weight) > 0 :
    step === 4 ? activity !== null :
    true;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header: progress + back + skip */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground disabled:opacity-30"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        {step < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={skipAll}
            className="text-sm text-muted-foreground px-2 py-1"
          >
            Skip
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* Step content */}
      <div key={step} className="flex-1 px-6 pt-6 pb-8 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="max-w-md mx-auto w-full flex-1 flex flex-col">
          {step === 0 && (
            <Welcome />
          )}
          {step === 1 && (
            <SexStep value={sex} onChange={(v) => { setSex(v); setTimeout(next, 150); }} />
          )}
          {step === 2 && (
            <AgeStep value={age} onChange={setAge} />
          )}
          {step === 3 && (
            <BodyStep height={height} weight={weight} onHeight={setHeight} onWeight={setWeight} />
          )}
          {step === 4 && (
            <ActivityStep value={activity} onChange={(v) => { setActivity(v); setTimeout(next, 150); }} />
          )}
          {step === 5 && (
            <ReviewStep sex={sex} age={age} height={height} weight={weight} activity={activity} />
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="px-6 pb-8 pt-2 max-w-md mx-auto w-full">
        {step < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={next}
            disabled={!canAdvance}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground text-base font-semibold shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
          >
            {step === 0 ? "Get started" : "Continue"}
            <ArrowRight className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            disabled={saving}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground text-base font-semibold shadow-sm transition disabled:opacity-60 active:scale-[0.99]"
          >
            {saving ? "Saving…" : (<><Check className="h-5 w-5" /> Start tracking</>)}
          </button>
        )}
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="flex-1 flex flex-col justify-center">
      <div className="h-16 w-16 rounded-3xl bg-primary/10 flex items-center justify-center mb-6">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight leading-tight mb-3">
        Welcome to KainFit
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed">
        Answer a few quick questions so we can personalize your experience. Takes less than 30 seconds.
      </p>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold tracking-tight mb-2">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SexStep({ value, onChange }: { value: Sex | null; onChange: (v: Sex) => void }) {
  const options: { key: Sex; label: string }[] = [
    { key: "male", label: "Male" },
    { key: "female", label: "Female" },
    { key: "prefer_not_to_say", label: "Prefer not to say" },
  ];
  return (
    <div>
      <StepHeader title="What's your sex?" subtitle="Used to personalize estimates. You can change this later." />
      <div className="space-y-3">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`w-full h-14 rounded-2xl border-2 text-base font-medium transition text-left px-5 flex items-center justify-between active:scale-[0.99] ${
              value === o.key
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-foreground hover:border-muted-foreground/40"
            }`}
          >
            <span>{o.label}</span>
            {value === o.key && <Check className="h-5 w-5 text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgeStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <StepHeader title="How old are you?" subtitle="This helps us estimate your energy needs." />
      <div className="flex items-baseline justify-center gap-3 py-4">
        <Input
          type="number"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
          placeholder="25"
          className="h-24 w-40 text-center text-6xl font-bold border-0 border-b-2 rounded-none focus-visible:ring-0 focus-visible:border-primary bg-transparent"
        />
        <span className="text-2xl text-muted-foreground font-medium">yrs</span>
      </div>
    </div>
  );
}

function BodyStep({
  height, weight, onHeight, onWeight,
}: {
  height: string; weight: string;
  onHeight: (v: string) => void; onWeight: (v: string) => void;
}) {
  return (
    <div>
      <StepHeader title="Your height & weight" subtitle="Stored privately on your profile." />
      <div className="space-y-5">
        <div className="rounded-2xl border-2 border-border p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Height</div>
          <div className="flex items-baseline gap-3">
            <Input
              type="number"
              inputMode="decimal"
              value={height}
              autoFocus
              onChange={(e) => onHeight(e.target.value)}
              placeholder="170"
              className="h-14 flex-1 text-3xl font-semibold border-0 focus-visible:ring-0 bg-transparent px-0"
            />
            <span className="text-lg text-muted-foreground font-medium">cm</span>
          </div>
        </div>
        <div className="rounded-2xl border-2 border-border p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Weight</div>
          <div className="flex items-baseline gap-3">
            <Input
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => onWeight(e.target.value)}
              placeholder="65"
              className="h-14 flex-1 text-3xl font-semibold border-0 focus-visible:ring-0 bg-transparent px-0"
            />
            <span className="text-lg text-muted-foreground font-medium">kg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityStep({ value, onChange }: { value: Activity | null; onChange: (v: Activity) => void }) {
  const options: { key: Activity; label: string; desc: string; emoji: string }[] = [
    { key: "sedentary", label: "Sedentary", desc: "Mostly sitting, little exercise", emoji: "🪑" },
    { key: "light", label: "Lightly active", desc: "Light exercise 1–3 days/week", emoji: "🚶" },
    { key: "moderate", label: "Moderately active", desc: "Exercise 3–5 days/week", emoji: "🏃" },
    { key: "very_active", label: "Very active", desc: "Intense exercise 6–7 days/week", emoji: "🔥" },
  ];
  return (
    <div>
      <StepHeader title="How active are you?" subtitle="Pick what best matches your typical week." />
      <div className="space-y-3">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`w-full text-left p-4 rounded-2xl border-2 transition flex items-center gap-4 active:scale-[0.99] ${
              value === o.key
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <div className="text-2xl">{o.emoji}</div>
            <div className="flex-1">
              <div className="font-semibold text-base">{o.label}</div>
              <div className="text-xs text-muted-foreground">{o.desc}</div>
            </div>
            {value === o.key && <Check className="h-5 w-5 text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewStep({
  sex, age, height, weight, activity,
}: {
  sex: Sex | null; age: string; height: string; weight: string; activity: Activity | null;
}) {
  const rows = [
    { label: "Sex", value: sex ? sexLabel(sex) : "—" },
    { label: "Age", value: age ? `${age} yrs` : "—" },
    { label: "Height", value: height ? `${height} cm` : "—" },
    { label: "Weight", value: weight ? `${weight} kg` : "—" },
    { label: "Activity", value: activity ? activityLabel(activity) : "—" },
  ];
  return (
    <div>
      <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
        <Check className="h-7 w-7 text-primary" />
      </div>
      <StepHeader title="You're all set" subtitle="Review your details — you can edit them anytime in Profile." />
      <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-3.5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className="text-sm font-medium">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function sexLabel(s: Sex) {
  return s === "male" ? "Male" : s === "female" ? "Female" : "Prefer not to say";
}
function activityLabel(a: Activity) {
  return a === "sedentary" ? "Sedentary" : a === "light" ? "Lightly active" : a === "moderate" ? "Moderately active" : "Very active";
}