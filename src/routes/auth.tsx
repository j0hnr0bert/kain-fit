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
import { track } from "@/lib/analytics";
import { logSignupFunnelEvent } from "@/lib/beta.functions";
import { useServerFn } from "@tanstack/react-start";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signup"),
  source: z.string().max(64).optional(),
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
  const logFunnel = useServerFn(logSignupFunnelEvent);

  function funnelSessionId(): string {
    if (typeof window === "undefined") return "";
    try {
      let sid = localStorage.getItem("kf.sid");
      if (!sid) {
        sid =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("kf.sid", sid);
      }
      return sid;
    } catch {
      return "";
    }
  }

  function logStep(step:
    | "signup_form_viewed"
    | "signup_email_entered"
    | "signup_password_entered"
    | "signup_submit_clicked"
    | "signup_validation_failed"
    | "signup_request_sent"
    | "signup_request_error"
    | "signup_email_verification_sent"
    | "signup_completed"
    | "oauth_google_started"
    | "oauth_google_failed"
    | "oauth_apple_started"
    | "oauth_apple_failed",
    reason?: string | null,
    detail?: string | null,
  ) {
    const sid = funnelSessionId();
    if (!sid) return;
    void logFunnel({
      data: { step, anonymous_session_id: sid, reason: reason ?? null, detail: detail ?? null },
    }).catch(() => {});
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/today", replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (mode === "signup") {
      track("signup_started", {});
      logStep("signup_form_viewed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    // New accounts skip the personal questionnaire entirely — mark as
    // onboarded so nothing bounces them to /onboarding. Existing rows are
    // preserved because ignoreDuplicates skips the upsert when a profile
    // already exists.
    await supabase
      .from("profiles")
      .upsert(
        { user_id: data.user.id, display_name: displayName, onboarded: true },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    // Ensure previously-created accounts that never finished onboarding
    // also skip the (now-removed) questionnaire.
    await supabase.from("profiles").update({ onboarded: true }).eq("user_id", data.user.id);

    if (isNewAccount) track("signup_completed", {});
    if (isNewAccount) logStep("signup_completed");
    navigate({ to: "/today", replace: true });
  }

  async function handleOAuth(provider: "google" | "apple") {
    if (oauthLoading || loading) return;
    setOauthLoading(provider);
    setFormError("");
    logStep(provider === "google" ? "oauth_google_started" : "oauth_apple_started");
    const failStep = provider === "google" ? "oauth_google_failed" : "oauth_apple_failed";
    const unavailableMsg = "Sign-in is temporarily unavailable — try email instead.";
    let completed = false;
    const reminderId = window.setTimeout(() => {
      if (completed) return;
      const msg = "Finish sign-in in the window that opened. If nothing opened, allow pop-ups and try again.";
      logStep(failStep, "still_waiting_after_8s", msg);
      setFormError(msg);
      toast.message(msg);
      setOauthLoading(null);
    }, 8000);
    try {
      const result = isEmbeddedLovableShell()
        ? await signInWithOAuthPopup(provider, window.location.origin)
        : await lovable.auth.signInWithOAuth(provider, {
            redirect_uri: window.location.origin,
          });
      completed = true;
      window.clearTimeout(reminderId);
      if (result.error) {
        const rawMessage = result.error.message ?? unavailableMsg;
        const msg = friendlyOAuthError(rawMessage);
        logStep(failStep, "provider_error", rawMessage);
        setFormError(msg);
        toast.error(msg);
        setOauthLoading(null);
        return;
      }
      if (result.redirected) {
        // Browser is navigating to the managed OAuth broker.
        return;
      }
      if (result.tokens) {
        const { error } = await supabase.auth.setSession(result.tokens);
        if (error) throw error;
      }
      await continueAfterAuth(mode === "signup");
    } catch (e) {
      completed = true;
      window.clearTimeout(reminderId);
      const rawMessage = e instanceof Error ? e.message : "Sign-in failed";
      const msg = friendlyOAuthError(rawMessage);
      logStep(failStep, "exception", rawMessage);
      setFormError(msg);
      toast.error(msg);
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

    if (mode === "signup") logStep("signup_submit_clicked");

    if (!emailValue || !passwordValue) {
      const msg = "Enter your email and password to continue.";
      setFormError(msg);
      if (mode === "signup") {
        logStep(
          "signup_validation_failed",
          !emailValue && !passwordValue ? "missing_both" : !emailValue ? "missing_email" : "missing_password",
          msg,
        );
      }
      return;
    }
    if (!emailValid) {
      const msg = "Please enter a valid email address.";
      setFormError(msg);
      if (mode === "signup") logStep("signup_validation_failed", "invalid_email_format", msg);
      return;
    }

    if (mode === "signup" && !passwordValid) {
      const msg = "Password does not meet the requirements below.";
      setFormError(msg);
      const failed = passwordChecks.filter((r) => !r.ok).map((r) => r.label).join(",");
      logStep("signup_validation_failed", "password_requirements", failed);
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        logStep("signup_request_sent");
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

        // No session returned and immediate sign-in failed → the account was
        // created but email confirmation is required.
        logStep("signup_email_verification_sent", null, signInError?.message ?? null);
        toast.success("Account created. Please sign in to continue.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: emailValue, password: passwordValue });
        if (error) throw error;
        await continueAfterAuth(false);
      }
    } catch (err) {
      const message = friendlyAuthError(err);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const status =
        typeof (err as { status?: unknown })?.status === "number"
          ? String((err as { status: number }).status)
          : typeof (err as { code?: unknown })?.code === "string"
            ? (err as { code: string }).code
            : "error";
      if (mode === "signup") {
        logStep("signup_request_error", status, rawMessage);
      }
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
                  onBlur={() => {
                    setEmailTouched(true);
                    if (mode === "signup" && email.trim().length > 0) logStep("signup_email_entered");
                  }}
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
                    onBlur={() => {
                      setPasswordTouched(true);
                      if (mode === "signup" && password.length > 0) logStep("signup_password_entered");
                    }}
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

function friendlyOAuthError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("popup") || lower.includes("blocked")) {
    return "Allow the sign-in window, then try again.";
  }
  if (lower.includes("cancelled") || lower.includes("canceled")) {
    return "Sign-in was cancelled. Try again when you're ready.";
  }
  if (lower.includes("preview mode") || lower.includes("new tab")) {
    return "Open the preview in a new tab to finish social sign-in.";
  }
  if (lower.includes("unsupported") || lower.includes("provider")) {
    return "This sign-in option is temporarily unavailable — try email instead.";
  }
  return message || "Sign-in is temporarily unavailable — try email instead.";
}

type OAuthProvider = "google" | "apple";
type OAuthPopupResult =
  | { error: Error; redirected?: false; tokens?: never }
  | { error: null; redirected?: false; tokens: { access_token: string; refresh_token: string } };

function isEmbeddedLovableShell() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top && /LovableApp\//i.test(navigator.userAgent);
  } catch {
    return true;
  }
}

function randomOAuthState() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
  return `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function signInWithOAuthPopup(provider: OAuthProvider, redirectUri: string): Promise<OAuthPopupResult> {
  const state = randomOAuthState();
  const params = new URLSearchParams({
    provider,
    redirect_uri: redirectUri,
    response_mode: "web_message",
    state,
  });
  const popup = window.open(`/~oauth/initiate?${params.toString()}`, "_blank");
  if (!popup) {
    return Promise.resolve({ error: new Error("Popup was blocked") });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: OAuthPopupResult) => {
      if (settled) return;
      settled = true;
      window.clearInterval(closedInterval);
      window.removeEventListener("message", onMessage);
      popup.close();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://oauth.lovable.app" && event.origin !== "https://lovable.dev") return;
      const payload = event.data as { type?: string; response?: Record<string, string | undefined> } | null;
      if (!payload || payload.type !== "authorization_response" || !payload.response) return;
      const response = payload.response;
      if (response.state !== state) {
        finish({ error: new Error("State is invalid") });
        return;
      }
      if (response.error) {
        finish({ error: new Error(response.error_description ?? response.error) });
        return;
      }
      if (!response.access_token || !response.refresh_token) {
        finish({ error: new Error("No tokens received") });
        return;
      }
      finish({
        error: null,
        tokens: {
          access_token: response.access_token,
          refresh_token: response.refresh_token,
        },
      });
    };

    window.addEventListener("message", onMessage);
    const closedInterval = window.setInterval(() => {
      if (popup.closed) finish({ error: new Error("Sign in was cancelled") });
    }, 500);
  });
}