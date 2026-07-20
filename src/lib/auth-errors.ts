// Centralized authentication error handler used by every auth surface
// (email signup/signin, phone OTP, Google OAuth, Apple OAuth).
//
// Given anything a Supabase / lovable auth call can throw or return in
// `.error`, produce a stable diagnostic record: the sanitized underlying
// error code, HTTP status, developer message, and a specific user-facing
// message keyed to the failure. Never returns a raw password, token, or
// bearer value — those never appear in `error.message` from supabase-js.
//
// Consumers use `.userMessage` in the UI, `.fieldTarget` to focus the
// right input, `.suggestion` to render an inline recovery CTA (e.g.
// "Sign in instead"), and `.code` / `.status` / `.rawMessage` for the
// `auth_attempt_completed` analytics event.

export type AuthProvider = "email" | "phone" | "google" | "apple";
export type AuthOperation = "signup" | "signin" | "otp_send" | "otp_verify" | "oauth";
export type AuthFieldTarget = "email" | "password" | "phone" | "otp" | "provider" | null;
export type AuthRecoverySuggestion =
  | "switch_to_signin"
  | "reset_password"
  | "confirm_email"
  | "retry"
  | "allow_popup"
  | "use_email"
  | null;

export type NormalizedAuthError = {
  /** Short user-facing message. Never a raw provider stack. */
  userMessage: string;
  /** Sanitized backend code (e.g. `user_already_exists`, `weak_password`). */
  code: string;
  /** HTTP status when available. `null` for client-only failures. */
  status: number | null;
  /** Original developer-safe message (no secrets). Truncated to 500 chars. */
  rawMessage: string;
  /** Which form field the error refers to, if any. */
  fieldTarget: AuthFieldTarget;
  /** Optional recovery hint the UI can use to render a specific CTA. */
  suggestion: AuthRecoverySuggestion;
};

function truncate(s: string, n = 500): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n);
}

function readStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { status?: unknown; statusCode?: unknown };
  if (typeof anyErr.status === "number") return anyErr.status;
  if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
  return null;
}

function readCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { code?: unknown; name?: unknown };
  if (typeof anyErr.code === "string" && anyErr.code) return anyErr.code;
  if (typeof anyErr.name === "string" && anyErr.name && anyErr.name !== "Error" && anyErr.name !== "AuthError") return anyErr.name;
  return null;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Unknown error";
}

/**
 * Normalize any auth failure (thrown Error, Supabase `AuthError`, or the
 * `{ error }` object returned by the lovable OAuth helper) into a stable
 * diagnostic record.
 */
export function normalizeAuthError(err: unknown): NormalizedAuthError {
  const rawMessage = truncate(readMessage(err));
  const status = readStatus(err);
  const providerCode = readCode(err);
  const lower = rawMessage.toLowerCase();

  // ── Signup / signin failures Supabase returns as 422 ───────────────
  if (
    lower.includes("user already registered") ||
    lower.includes("already been registered") ||
    providerCode === "user_already_exists"
  ) {
    return {
      userMessage: "This email is already registered. Sign in instead.",
      code: "user_already_exists",
      status: status ?? 422,
      rawMessage,
      fieldTarget: "email",
      suggestion: "switch_to_signin",
    };
  }

  if (
    lower.includes("password is known to be weak") ||
    lower.includes("weak password") ||
    lower.includes("password should be at least") ||
    providerCode === "weak_password"
  ) {
    return {
      userMessage:
        "That password has appeared in a data breach. Please choose a different, stronger one.",
      code: "weak_password",
      status: status ?? 422,
      rawMessage,
      fieldTarget: "password",
      suggestion: null,
    };
  }

  if (
    lower.includes("unable to validate email address") ||
    lower.includes("invalid email") ||
    providerCode === "email_address_invalid" ||
    providerCode === "validation_failed"
  ) {
    return {
      userMessage: "That email address looks invalid. Please check for typos.",
      code: providerCode ?? "email_address_invalid",
      status: status ?? 422,
      rawMessage,
      fieldTarget: "email",
      suggestion: null,
    };
  }

  // ── Signin failures ────────────────────────────────────────────────
  if (lower.includes("invalid login credentials") || providerCode === "invalid_credentials") {
    return {
      userMessage: "Email or password is incorrect.",
      code: "invalid_credentials",
      status: status ?? 400,
      rawMessage,
      fieldTarget: "password",
      suggestion: "reset_password",
    };
  }

  if (lower.includes("email not confirmed") || providerCode === "email_not_confirmed") {
    return {
      userMessage:
        "Please confirm your email address first. Check your inbox for the KainFit confirmation email.",
      code: "email_not_confirmed",
      status: status ?? 400,
      rawMessage,
      fieldTarget: null,
      suggestion: "confirm_email",
    };
  }

  // ── Rate limits ────────────────────────────────────────────────────
  if (
    lower.includes("rate limit") ||
    lower.includes("over_email_send_rate_limit") ||
    lower.includes("over_sms_send_rate_limit") ||
    status === 429
  ) {
    return {
      userMessage: "Too many attempts. Please wait a minute and try again.",
      code: "rate_limited",
      status: status ?? 429,
      rawMessage,
      fieldTarget: null,
      suggestion: "retry",
    };
  }

  // ── Phone / OTP ────────────────────────────────────────────────────
  if (lower.includes("phone provider") || lower.includes("unsupported phone")) {
    return {
      userMessage: "Phone sign-in is not active yet. Please use email, Google, or Apple.",
      code: "phone_provider_disabled",
      status,
      rawMessage,
      fieldTarget: "phone",
      suggestion: "use_email",
    };
  }
  if (lower.includes("invalid phone") || lower.includes("phone number")) {
    return {
      userMessage: "Please enter a valid phone number in +63 format.",
      code: "invalid_phone",
      status,
      rawMessage,
      fieldTarget: "phone",
      suggestion: null,
    };
  }
  if (lower.includes("token has expired") || lower.includes("otp expired") || lower.includes("invalid otp")) {
    return {
      userMessage: "That code is invalid or expired. Send a new one and try again.",
      code: "otp_invalid",
      status,
      rawMessage,
      fieldTarget: "otp",
      suggestion: "retry",
    };
  }

  // ── OAuth (Google / Apple) ─────────────────────────────────────────
  if (lower.includes("popup") && (lower.includes("blocked") || lower.includes("closed"))) {
    return {
      userMessage: "Allow the sign-in pop-up in your browser, then try again.",
      code: "popup_blocked",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "allow_popup",
    };
  }
  if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("user cancelled")) {
    return {
      userMessage: "Sign-in was cancelled. Try again when you're ready.",
      code: "user_cancelled",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "retry",
    };
  }
  if (lower.includes("state is invalid") || lower.includes("state mismatch")) {
    return {
      userMessage: "Sign-in was interrupted. Please try again.",
      code: "oauth_state_mismatch",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "retry",
    };
  }
  if (lower.includes("no tokens received") || lower.includes("expired")) {
    return {
      userMessage: "Sign-in expired before it finished. Try again.",
      code: "oauth_expired",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "retry",
    };
  }
  if (lower.includes("still_waiting_after") || lower.includes("no completion within")) {
    return {
      userMessage: "Finish sign-in in the window that opened. If nothing opened, allow pop-ups and try again.",
      code: "oauth_slow",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "allow_popup",
    };
  }
  if (lower.includes("unsupported provider") || lower.includes("provider is not enabled") || providerCode === "provider_disabled") {
    return {
      userMessage: "This sign-in option is temporarily unavailable — please use email.",
      code: "provider_disabled",
      status,
      rawMessage,
      fieldTarget: "provider",
      suggestion: "use_email",
    };
  }
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return {
      userMessage: "Network problem — check your connection and try again.",
      code: "network_error",
      status,
      rawMessage,
      fieldTarget: null,
      suggestion: "retry",
    };
  }

  // ── Fallback ───────────────────────────────────────────────────────
  return {
    userMessage: rawMessage || "Sign-in failed. Please try again.",
    code: providerCode ?? (status ? `http_${status}` : "unknown"),
    status,
    rawMessage,
    fieldTarget: null,
    suggestion: "retry",
  };
}
