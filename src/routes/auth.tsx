import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Mail, Phone } from "lucide-react";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signup"),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [method, setMethod] = useState<"choose" | "email" | "phone">(
    initialMode === "signup" ? "email" : "choose",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/today", replace: true });
    });
  }, [navigate]);

  const passwordHint = useMemo(() => getPasswordHint(password), [password]);

  function updateMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    setFormError("");
    if (nextMode === "signup") setMethod("email");
  }

  async function continueAfterAuth(isNewAccount: boolean) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new Error("Account created, but we couldn't start your session. Please sign in.");
    }

    const displayName = data.user.email?.split("@")[0] ?? "KainFit user";
    await supabase
      .from("profiles")
      .upsert(
        { user_id: data.user.id, display_name: displayName },
        { onConflict: "user_id", ignoreDuplicates: true },
      );

    navigate({ to: isNewAccount ? "/onboarding" : "/today", replace: true });
  }

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/today", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    }
  }

  async function handleEmail(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    setFormError("");

    const emailValue = email.trim();
    const passwordValue = password;

    if (!emailValue || !passwordValue) {
      setFormError("Enter your email and password to continue.");
      return;
    }

    if (mode === "signup" && passwordHint) {
      setFormError(passwordHint);
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: emailValue,
          password: passwordValue,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: emailValue.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.session) {
          await continueAfterAuth(true);
          return;
        }

        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: emailValue,
          password: passwordValue,
        });
        if (!signInError && signInData.session) {
          await continueAfterAuth(true);
          return;
        }

        toast.success("Account created. Please sign in to continue.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: emailValue, password: passwordValue });
        if (error) throw error;
        await continueAfterAuth(false);
      }
    } catch (err) {
      const message = friendlyAuthError(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePhoneSend(e?: React.FormEvent) {
    e?.preventDefault();
    setFormError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
      setOtpSent(true);
      toast.success("Code sent to your phone");
    } catch (err) {
      const message = friendlyAuthError(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePhoneVerify(e?: React.FormEvent) {
    e?.preventDefault();
    setFormError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });
      if (error) throw error;
      await continueAfterAuth(mode === "signup");
    } catch (err) {
      const message = friendlyAuthError(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background px-6 pt-6 pb-10 flex flex-col">
        <button
        type="button"
        onClick={() => (method === "choose" ? navigate({ to: "/" }) : setMethod("choose"))}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground w-fit -ml-2 px-2 py-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {mode === "signup"
            ? "Start tracking in seconds."
            : "Sign in to continue tracking."}
        </p>

        {method === "choose" && (
          <div className="space-y-3">
            <Button
              type="button"
              onClick={() => handleOAuth("apple")}
              disabled={loading}
              className="w-full h-12 rounded-2xl bg-foreground text-background hover:bg-foreground/90"
            >
              Continue with Apple
            </Button>
            <Button
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={loading}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              Continue with Google
            </Button>
            <Button
              type="button"
              onClick={() => setMethod("email")}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              <Mail className="mr-2 h-4 w-4" /> Continue with email
            </Button>
            <Button
              type="button"
              onClick={() => setMethod("phone")}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              <Phone className="mr-2 h-4 w-4" /> Continue with phone number
            </Button>
          </div>
        )}

        {method === "email" && (
          <form onSubmit={handleEmail} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">
                  Use 8+ characters with uppercase, lowercase, and a number.
                </p>
              )}
            </div>
            {formError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <button
              type="button"
              onClick={handleEmail}
              disabled={loading || (mode === "signup" && Boolean(passwordHint))}
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button type="button" onClick={() => handleOAuth("apple")} disabled={loading} variant="outline" className="h-11 rounded-xl">
                Apple
              </Button>
              <Button type="button" onClick={() => handleOAuth("google")} disabled={loading} variant="outline" className="h-11 rounded-xl">
                Google
              </Button>
            </div>
          </form>
        )}

        {method === "phone" && !otpSent && (
          <form onSubmit={handlePhoneSend} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" type="tel" placeholder="+639171234567" required value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 rounded-xl" />
              <p className="text-xs text-muted-foreground">
                Enter a Philippine mobile number in +63 format.
              </p>
            </div>
            {formError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {method === "phone" && otpSent && (
          <form onSubmit={handlePhoneVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input id="otp" inputMode="numeric" required value={otp} onChange={(e) => setOtp(e.target.value)} className="h-12 rounded-xl text-center tracking-widest text-lg" />
            </div>
            {formError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              {loading ? "Verifying…" : "Verify & continue"}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? (
            <>Already have an account?{" "}
              <button type="button" onClick={() => updateMode("signin")} className="text-primary font-medium">Sign in</button>
            </>
          ) : (
            <>New here?{" "}
              <button type="button" onClick={() => updateMode("signup")} className="text-primary font-medium">Create account</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getPasswordHint(password: string) {
  if (!password) return "";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Add at least one lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add at least one uppercase letter.";
  if (!/\d/.test(password)) return "Add at least one number.";
  return "";
}

function friendlyAuthError(err: unknown) {
  const message = err instanceof Error ? err.message : "Something went wrong";
  const lower = message.toLowerCase();

  if (lower.includes("weak_password") || lower.includes("password")) {
    return "Use a stronger password that has not appeared in a data breach.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "This email already has an account. Sign in instead.";
  }
  if (lower.includes("unsupported phone provider") || lower.includes("phone provider")) {
    return "Phone OTP is not active yet. Please use email, Google, or Apple for now.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email first, then sign in.";
  }

  return message;
}