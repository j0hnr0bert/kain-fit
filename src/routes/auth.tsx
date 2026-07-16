import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Check, Eye, EyeOff, Phone, Loader2 } from "lucide-react";

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
  const [method, setMethod] = useState<"main" | "phone">("main");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<null | "google" | "apple">(null);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/today", replace: true });
    });
  }, [navigate]);

  const passwordChecks = useMemo(() => checkPassword(password), [password]);
  const passwordValid = passwordChecks.every((r) => r.ok);
  const emailValid = /.+@.+\..+/.test(email.trim());

  function updateMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    setFormError("");
    setPasswordTouched(false);
    setEmailTouched(false);
    setMethod("main");
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
    if (oauthLoading || loading) return;
    setOauthLoading(provider);
    setFormError("");
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setOauthLoading(null);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/today", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setOauthLoading(null);
    }
  }

  async function handleEmail(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (loading) return;
    setFormError("");
    setEmailTouched(true);
    setPasswordTouched(true);

    const emailValue = email.trim();
    const passwordValue = password;

    if (!emailValue || !passwordValue) {
      setFormError("Enter your email and password to continue.");
      return;
    }
    if (!emailValid) {
      setFormError("Please enter a valid email address.");
      return;
    }

    if (mode === "signup" && !passwordValid) {
      setFormError("Password does not meet the requirements below.");
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

  const submitDisabled =
    loading ||
    oauthLoading !== null ||
    !email.trim() ||
    !password ||
    (mode === "signup" && !passwordValid);

  const showEmailError = emailTouched && email.length > 0 && !emailValid;

  return (
    <div
      className="min-h-[100dvh] bg-background px-6 flex flex-col"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
      }}
    >
      <button
        type="button"
        onClick={() => (method === "main" ? navigate({ to: "/" }) : setMethod("main"))}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground w-fit -ml-2 px-2 py-2 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {mode === "signup" ? "Start tracking in seconds." : "Sign in to continue tracking."}
        </p>

        {method === "main" && (
          <div className="mt-6 space-y-3">
            {/* Social first */}
            <button
              type="button"
              onClick={() => handleOAuth("apple")}
              disabled={loading || oauthLoading !== null}
              className="w-full h-12 rounded-2xl bg-foreground text-background font-medium inline-flex items-center justify-center gap-2 transition active:scale-[0.99] hover:bg-foreground/90 disabled:opacity-60 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
            >
              {oauthLoading === "apple" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <AppleIcon className="h-5 w-5" />
              )}
              <span>Continue with Apple</span>
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              disabled={loading || oauthLoading !== null}
              className="w-full h-12 rounded-2xl bg-card border border-border text-foreground font-medium inline-flex items-center justify-center gap-2 transition active:scale-[0.99] hover:bg-muted disabled:opacity-60 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
            >
              {oauthLoading === "google" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <GoogleIcon className="h-5 w-5" />
              )}
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="relative py-2" role="separator" aria-label="or continue with email">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
                  or continue with email
                </span>
              </div>
            </div>

            <form onSubmit={handleEmail} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={showEmailError || undefined}
                  aria-describedby={showEmailError ? "email-error" : undefined}
                  className="h-12 rounded-xl"
                />
                {showEmailError && (
                  <p id="email-error" className="text-xs text-destructive">
                    Please enter a valid email address.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setPasswordTouched(true)}
                    aria-invalid={mode === "signup" && passwordTouched && !passwordValid ? true : undefined}
                    aria-describedby={mode === "signup" ? "password-requirements" : undefined}
                    className="h-12 rounded-xl pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    tabIndex={0}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <ul
                    id="password-requirements"
                    aria-live="polite"
                    className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]"
                  >
                    {passwordChecks.map((r) => (
                      <li
                        key={r.label}
                        className={
                          !passwordTouched
                            ? "text-muted-foreground"
                            : r.ok
                              ? "text-primary"
                              : "text-muted-foreground"
                        }
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={
                              "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border " +
                              (r.ok
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-border")
                            }
                            aria-hidden="true"
                          >
                            {r.ok && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          {r.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div
                role="alert"
                aria-live="assertive"
                className={
                  formError
                    ? "rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    : "sr-only"
                }
              >
                {formError}
              </div>

              <Button
                type="submit"
                disabled={submitDisabled}
                className="w-full h-12 rounded-2xl text-base transition active:scale-[0.99] motion-reduce:active:scale-100"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Please wait…
                  </span>
                ) : mode === "signup" ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>

              {mode === "signup" && (
                <p className="text-[12px] text-muted-foreground text-center leading-relaxed px-2">
                  By creating an account, you agree to our{" "}
                  <Link to="/terms" className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                    Terms of Service
                  </Link>{" "}
                  and acknowledge our{" "}
                  <Link to="/privacy" className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                    Privacy Policy
                  </Link>
                  .
                </p>
              )}
            </form>

            <button
              type="button"
              onClick={() => setMethod("phone")}
              className="w-full h-11 rounded-xl text-sm text-muted-foreground inline-flex items-center justify-center gap-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Phone className="h-4 w-4" /> Use phone number instead
            </button>
          </div>
        )}

        {method === "phone" && !otpSent && (
          <form onSubmit={handlePhoneSend} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+639171234567"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                Enter a Philippine mobile number in +63 format.
              </p>
            </div>
            {formError && (
              <div role="alert" aria-live="assertive" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {method === "phone" && otpSent && (
          <form onSubmit={handlePhoneVerify} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="h-12 rounded-xl text-center tracking-widest text-lg"
              />
            </div>
            {formError && (
              <div role="alert" aria-live="assertive" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => updateMode("signin")} className="text-primary font-medium underline underline-offset-2">
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" onClick={() => updateMode("signup")} className="text-primary font-medium underline underline-offset-2">
                Create account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function checkPassword(password: string) {
  return [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Lowercase letter", ok: /[a-z]/.test(password) },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /\d/.test(password) },
  ];
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.24 3.06-.83.84-2 1.47-3.14 1.38-.13-1.1.4-2.24 1.16-3.02.83-.86 2.15-1.49 3.22-1.42zM20.5 17.06c-.55 1.27-.81 1.83-1.52 2.94-.99 1.55-2.39 3.48-4.12 3.5-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.03-3.06-1.77-4.05-3.31C0.99 16.94.3 12.83 2.02 10.03c1.22-1.99 3.15-3.16 4.96-3.16 1.85 0 3 1.02 4.53 1.02 1.48 0 2.39-1.02 4.53-1.02 1.62 0 3.34.88 4.57 2.4-4.01 2.2-3.36 7.94-.11 8.79z"/>
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
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