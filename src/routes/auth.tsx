import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { logSignupFunnelEvent } from "@/lib/beta.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  normalizeAuthError,
  type AuthProvider,
  type AuthOperation,
  type AuthRecoverySuggestion,
} from "@/lib/auth-errors";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signup"),
  source: z.string().max(64).optional(),
  // Same-origin relative path to return to after auth (used by the OAuth
  // consent screen so MCP clients land back on the approval page).
  next: z.string().max(512).optional(),
});

/** Only same-origin relative paths are allowed as a post-auth destination. */
function safeNext(next?: string): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode, next: nextParam } = useSearch({ from: "/auth" });
  const nextPath = safeNext(nextParam);
  const returnUrl =
    typeof window !== "undefined"
      ? nextPath
        ? `${window.location.origin}${nextPath}`
        : window.location.origin
      : "";
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<null | "google" | "apple">(null);
  const [formError, setFormError] = useState("");
  const [lastFailedAction, setLastFailedAction] = useState<null | "email" | "google" | "apple">(
    null,
  );
  const [errorSuggestion, setErrorSuggestion] = useState<AuthRecoverySuggestion>(null);
  const logFunnel = useServerFn(logSignupFunnelEvent);
  // Whether the visitor arrived with demo entries waiting to be imported —
  // purely a copy decision (see today.tsx for the actual import handling,
  // untouched here). Read once; this page doesn't need to react to it
  // changing mid-session.
  const [fromDemo, setFromDemo] = useState(false);
  useEffect(() => {
    try {
      setFromDemo(Boolean(localStorage.getItem("kf.demoPendingImport")));
    } catch {
      // ignore
    }
  }, []);

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

  function platformTag(): string {
    if (typeof window === "undefined") return "ssr";
    const ua = navigator.userAgent || "";
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return "pwa";
    if (/iPhone|iPad|iPod/i.test(ua)) return "ios_safari";
    if (/Android/i.test(ua)) return "android";
    return "desktop";
  }

  /**
   * Centralized telemetry for every authentication attempt.
   * Emits one sanitized `auth_attempt_completed` event with provider,
   * operation, success flag, backend code, HTTP status, duration, and
   * platform. Never logs passwords, tokens, or authorization codes.
   */
  function recordAuthAttempt(
    provider: AuthProvider,
    operation: AuthOperation,
    startedAt: number,
    err?: unknown,
  ) {
    const duration = Math.max(0, Math.round(performance.now() - startedAt));
    if (!err) {
      track("auth_attempt_completed", {
        provider,
        operation,
        success: true,
        duration_ms: duration,
        platform: platformTag(),
      });
      return null;
    }
    const norm = normalizeAuthError(err);
    track("auth_attempt_completed", {
      provider,
      operation,
      success: false,
      duration_ms: duration,
      platform: platformTag(),
      error_code: norm.code,
      status: norm.status ?? "n/a",
      reason: norm.rawMessage.slice(0, 200),
      field_target: norm.fieldTarget ?? "none",
    });
    return norm;
  }

  function logStep(
    step:
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
      if (!data.user) return;
      if (nextPath) {
        window.location.replace(nextPath);
        return;
      }
      navigate({ to: "/today", replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, nextPath]);

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
    if (nextPath) {
      window.location.replace(nextPath);
      return;
    }
    navigate({ to: "/today", replace: true });
  }

  async function handleOAuth(provider: "google" | "apple") {
    if (oauthLoading || loading) return;
    track("auth_method_chosen", { method: provider, mode });
    setOauthLoading(provider);
    setFormError("");
    setLastFailedAction(null);
    setErrorSuggestion(null);
    logStep(provider === "google" ? "oauth_google_started" : "oauth_apple_started");
    const failStep = provider === "google" ? "oauth_google_failed" : "oauth_apple_failed";
    const startedAt = performance.now();
    let completed = false;
    const reminderId = window.setTimeout(() => {
      if (completed) return;
      const msg =
        "Finish sign-in in the window that opened. If nothing opened, allow pop-ups and try again.";
      logStep(failStep, "still_waiting_after_8s", msg);
      setFormError(msg);
      toast.message(msg);
      setOauthLoading(null);
    }, 8000);
    try {
      const result = isEmbeddedLovableShell()
        ? await signInWithOAuthPopup(provider, returnUrl)
        : await lovable.auth.signInWithOAuth(provider, {
            redirect_uri: returnUrl,
          });
      completed = true;
      window.clearTimeout(reminderId);
      if (result.error) {
        const norm = recordAuthAttempt(provider, "oauth", startedAt, result.error)!;
        logStep(failStep, norm.code, norm.rawMessage);
        if (mode === "signup")
          track("signup_failed", { method: provider, reason: norm.rawMessage.slice(0, 120) });
        setFormError(norm.userMessage);
        setErrorSuggestion(norm.suggestion);
        setLastFailedAction(provider);
        toast.error(norm.userMessage);
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
      recordAuthAttempt(provider, "oauth", startedAt);
      await continueAfterAuth(mode === "signup");
    } catch (e) {
      completed = true;
      window.clearTimeout(reminderId);
      const norm = recordAuthAttempt(provider, "oauth", startedAt, e)!;
      logStep(failStep, norm.code, norm.rawMessage);
      if (mode === "signup")
        track("signup_failed", { method: provider, reason: norm.rawMessage.slice(0, 120) });
      setFormError(norm.userMessage);
      setErrorSuggestion(norm.suggestion);
      setLastFailedAction(provider);
      toast.error(norm.userMessage);
      setOauthLoading(null);
    }
  }

  async function handleEmail(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (loading) return;
    setFormError("");
    setLastFailedAction(null);
    setErrorSuggestion(null);
    setEmailTouched(true);
    setPasswordTouched(true);

    const emailValue = email.trim();
    const passwordValue = password;

    if (mode === "signup") logStep("signup_submit_clicked");
    if (mode === "signup") track("auth_method_chosen", { method: "email", mode });

    if (!emailValue || !passwordValue) {
      const msg = "Enter your email and password to continue.";
      setFormError(msg);
      if (mode === "signup") {
        logStep(
          "signup_validation_failed",
          !emailValue && !passwordValue
            ? "missing_both"
            : !emailValue
              ? "missing_email"
              : "missing_password",
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
      const failed = passwordChecks
        .filter((r) => !r.ok)
        .map((r) => r.label)
        .join(",");
      logStep("signup_validation_failed", "password_requirements", failed);
      return;
    }

    setLoading(true);
    const startedAt = performance.now();
    try {
      if (mode === "signup") {
        logStep("signup_request_sent");
        const { data, error } = await supabase.auth.signUp({
          email: emailValue,
          password: passwordValue,
          options: {
            emailRedirectTo: returnUrl,
            data: { display_name: emailValue.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.session) {
          recordAuthAttempt("email", "signup", startedAt);
          await continueAfterAuth(true);
          return;
        }

        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: emailValue,
          password: passwordValue,
        });
        if (!signInError && signInData.session) {
          recordAuthAttempt("email", "signup", startedAt);
          await continueAfterAuth(true);
          return;
        }

        // No session returned and immediate sign-in failed → the account was
        // created but email confirmation is required.
        logStep("signup_email_verification_sent", null, signInError?.message ?? null);
        recordAuthAttempt("email", "signup", startedAt);
        toast.success("Account created. Please sign in to continue.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailValue,
          password: passwordValue,
        });
        if (error) throw error;
        recordAuthAttempt("email", "signin", startedAt);
        await continueAfterAuth(false);
      }
    } catch (err) {
      const op: AuthOperation = mode === "signup" ? "signup" : "signin";
      const norm = recordAuthAttempt("email", op, startedAt, err)!;
      const status = norm.status ? String(norm.status) : norm.code;
      if (mode === "signup") {
        logStep("signup_request_error", status, norm.rawMessage);
        track("signup_failed", { method: "email", reason: norm.rawMessage.slice(0, 120) });
      }
      setFormError(norm.userMessage);
      setErrorSuggestion(norm.suggestion);
      if (norm.fieldTarget === "email") setEmailTouched(true);
      if (norm.fieldTarget === "password") setPasswordTouched(true);
      setLastFailedAction("email");
      toast.error(norm.userMessage);
    } finally {
      setLoading(false);
    }
  }

  function retryLastAction() {
    switch (lastFailedAction) {
      case "email":
        void handleEmail();
        break;
      case "google":
        void handleOAuth("google");
        break;
      case "apple":
        void handleOAuth("apple");
        break;
      default:
        break;
    }
  }

  const submitDisabled =
    loading || !email.trim() || !password || (mode === "signup" && !passwordValid);

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
        onClick={() => navigate({ to: "/" })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground w-fit -ml-2 px-2 py-2 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex-1 flex flex-col max-w-sm mx-auto w-full pt-2">
        {/* Brand header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
            K
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tracking-tight">KainFit</span>
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {mode === "signup" ? "Create your free account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-lg font-medium text-foreground">
          Know what you ate. <span className="text-primary">Instantly.</span>
        </p>
        <p className="mt-0.5 text-sm font-medium text-primary">Kain mo. Klaro agad.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signup"
            ? fromDemo
              ? "Create your free account to save your demo day."
              : "Save today's entries and keep tracking."
            : "Fast macro tracking built for Filipino food."}
        </p>
        {mode === "signup" && (
          <>
            <p className="mt-3 inline-flex flex-wrap items-center gap-1 text-[12px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-3 py-1.5 w-fit">
              Free beta · No credit card required · Start in under 30 seconds
            </p>
            <div className="mt-4 rounded-2xl border border-border bg-muted/40 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What your account saves
              </div>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                <li>Today's entries</li>
                <li>Daily calories and macros</li>
                <li>Recent foods and saved meals</li>
              </ul>
            </div>
          </>
        )}

        <div className="mt-6 space-y-3">
          {/* Beta auth methods (2026-07-26): Google + email only. Phone
                was removed entirely (unsupported backend). Apple OAuth
                integration is intentionally left intact below
                (handleOAuth("apple"), oauthLoading's "apple" state,
                AppleIcon) but has no button reaching it — hidden from the
                beta UX pending real demand, not deleted. See the
                acquisition-sprint report for what remains dormant. */}
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
                    if (mode === "signup" && password.length > 0)
                      logStep("signup_password_entered");
                  }}
                  aria-invalid={
                    mode === "signup" && passwordTouched && !passwordValid ? true : undefined
                  }
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
              <div className="flex items-start justify-between gap-2">
                <span className="flex-1">{formError}</span>
                {formError && lastFailedAction && (
                  <button
                    type="button"
                    onClick={retryLastAction}
                    className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                  >
                    Retry
                  </button>
                )}
              </div>
              {formError && errorSuggestion === "switch_to_signin" && (
                <button
                  type="button"
                  onClick={() => updateMode("signin")}
                  className="mt-2 text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  Sign in with this email instead →
                </button>
              )}
              {formError && errorSuggestion === "reset_password" && (
                <p className="mt-2 text-xs opacity-80">
                  Forgot your password? Contact support to reset it.
                </p>
              )}
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
                <Link
                  to="/terms"
                  className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  Terms of Service
                </Link>{" "}
                and acknowledge our{" "}
                <Link
                  to="/privacy"
                  className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            )}
          </form>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => updateMode("signin")}
                className="text-primary font-medium underline underline-offset-2"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => updateMode("signup")}
                className="text-primary font-medium underline underline-offset-2"
              >
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
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.24 3.06-.83.84-2 1.47-3.14 1.38-.13-1.1.4-2.24 1.16-3.02.83-.86 2.15-1.49 3.22-1.42zM20.5 17.06c-.55 1.27-.81 1.83-1.52 2.94-.99 1.55-2.39 3.48-4.12 3.5-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.03-3.06-1.77-4.05-3.31C0.99 16.94.3 12.83 2.02 10.03c1.22-1.99 3.15-3.16 4.96-3.16 1.85 0 3 1.02 4.53 1.02 1.48 0 2.39-1.02 4.53-1.02 1.62 0 3.34.88 4.57 2.4-4.01 2.2-3.36 7.94-.11 8.79z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
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

function signInWithOAuthPopup(
  provider: OAuthProvider,
  redirectUri: string,
): Promise<OAuthPopupResult> {
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
      if (event.origin !== "https://oauth.lovable.app" && event.origin !== "https://lovable.dev")
        return;
      const payload = event.data as {
        type?: string;
        response?: Record<string, string | undefined>;
      } | null;
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
