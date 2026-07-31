// Client-side analytics helper.
// - Reads ?source= from the URL on first load and persists it for the session.
// - Maintains a stable anonymous session id in localStorage.
// - Sends events to the server via `trackEvent` server function.
// - Fails silently (no user-facing errors, no throws).

import { trackEvent } from "./beta.functions";

const SESSION_KEY = "kf.sid";
const SOURCE_KEY = "kf.src";
const UTM_KEY = "kf.utm";
const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
type UtmParams = Partial<Record<(typeof UTM_PARAMS)[number], string>>;

function isBrowser() {
  return typeof window !== "undefined";
}

function readSource(): string | null {
  if (!isBrowser()) return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("source");
    if (fromUrl) {
      const v = fromUrl.slice(0, 64);
      // Durable: survives OAuth redirect and browser restart.
      localStorage.setItem(SOURCE_KEY, v);
      return v;
    }
    const stored = localStorage.getItem(SOURCE_KEY) ?? sessionStorage.getItem(SOURCE_KEY);
    if (stored && !localStorage.getItem(SOURCE_KEY)) {
      localStorage.setItem(SOURCE_KEY, stored); // migrate legacy session value
    }
    return stored;
  } catch {
    return null;
  }
}

function readUtm(): UtmParams {
  if (!isBrowser()) return {};
  try {
    const url = new URL(window.location.href);
    const fresh: UtmParams = {};
    for (const key of UTM_PARAMS) {
      const v = url.searchParams.get(key);
      if (v) fresh[key] = v.slice(0, 128);
    }
    if (Object.keys(fresh).length > 0) {
      localStorage.setItem(UTM_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const cached = localStorage.getItem(UTM_KEY) ?? sessionStorage.getItem(UTM_KEY);
    if (cached && !localStorage.getItem(UTM_KEY)) {
      localStorage.setItem(UTM_KEY, cached); // migrate legacy session value
    }
    return cached ? (JSON.parse(cached) as UtmParams) : {};
  } catch {
    return {};
  }
}

export function getUtmParams(): UtmParams {
  return readUtm();
}

export function getAcquisitionSource(): string | null {
  return readSource();
}

export function withSourceSearch<T extends Record<string, unknown>>(extra?: T) {
  const src = getAcquisitionSource();
  return { ...(extra ?? {}), ...(src ? { source: src } : {}) } as T & { source?: string };
}

function getSessionId(): string {
  if (!isBrowser()) return "";
  try {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return "";
  }
}

function deviceCategory(): "mobile" | "tablet" | "desktop" {
  if (!isBrowser()) return "desktop";
  const w = window.innerWidth || 1024;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

// Local duplicate suppression: same event within 1s is dropped client-side too.
const lastSent = new Map<string, number>();

export type EventName =
  | "landing_viewed"
  | "demo_started"
  | "demo_food_submitted"
  | "demo_food_confirmed"
  | "signup_started"
  | "signup_completed"
  | "onboarding_completed"
  | "food_submitted"
  | "food_parse_succeeded"
  | "food_parse_failed"
  | "food_clarification_requested"
  | "food_edited_before_confirmation"
  | "food_confirmed"
  | "food_deleted"
  | "incorrect_macros_reported"
  | "saved_meal_repeated"
  | "feedback_submitted"
  | "app_returned"
  | "admin_dashboard_viewed"
  // Perf telemetry (phase 1 baseline)
  | "app_loaded"
  | "today_ready"
  | "food_search_started"
  | "food_search_results_shown"
  | "food_calculation_started"
  | "food_calculation_completed"
  | "food_log_saved"
  | "cache_hit"
  | "cache_miss"
  | "performance_error"
  | "web_vital"
  | "auth_method_chosen"
  | "signup_failed"
  | "first_food_logged"
  | "first_meal_saved"
  | "auth_attempt_completed"
  | "scale_guide_opened"
  | "scale_guide_completed"
  | "scale_example_started"
  | "scale_example_logged"
  | "recent_item_reused"
  | "favorite_used"
  | "saved_meal_reused"
  | "rage_tap"
  // Acquisition/PWA sprint (2026-07-26)
  | "install_cta_shown"
  | "install_cta_selected"
  | "install_accepted"
  | "install_dismissed"
  | "ios_install_guide_opened"
  | "already_installed"
  | "post_demo_signup_selected"
  | "post_demo_install_selected";

// These fire more than once per second (e.g. web_vital LCP+INP+CLS,
// cache_hit per item) — client-side dedupe would silently drop them.
const NO_DEDUPE = new Set<EventName>([
  "web_vital",
  "cache_hit",
  "cache_miss",
  "food_calculation_started",
  "food_calculation_completed",
  "food_log_saved",
  "performance_error",
  "auth_attempt_completed",
  "rage_tap",
]);

export function track(event: EventName, properties: Record<string, unknown> = {}): void {
  if (!isBrowser()) return;
  const now = Date.now();
  if (!NO_DEDUPE.has(event)) {
    const last = lastSent.get(event) ?? 0;
    if (now - last < 1000) return;
    lastSent.set(event, now);
  }

  const sid = getSessionId();
  const source = readSource();
  const utm = readUtm();
  const props: Record<string, unknown> = {
    device_category: deviceCategory(),
    ...utm,
    ...properties,
  };

  // Fire-and-forget. Never throw.
  void trackEvent({
    data: {
      event_name: event,
      anonymous_session_id: sid,
      acquisition_source: source ?? null,
      event_properties: props,
    },
  }).catch(() => {
    // swallow — analytics must never break the app
  });
}

// Lightweight, reusable rage-tap detector for any interactive element.
// Fires once when the same elementKey is tapped RAGE_THRESHOLD times within
// RAGE_WINDOW_MS, then resets so a long burst doesn't spam events. Same
// sliding-window idea already used for AI rate limiting (ai-guard.server.ts)
// — no new dependency, just call this from an existing onClick handler.
const rageTapBuckets = new Map<string, number[]>();
const RAGE_WINDOW_MS = 1500;
const RAGE_THRESHOLD = 3;

export function noteTapForRageDetection(elementKey: string): void {
  if (!isBrowser()) return;
  const now = Date.now();
  const kept = (rageTapBuckets.get(elementKey) ?? []).filter((t) => now - t < RAGE_WINDOW_MS);
  kept.push(now);
  if (kept.length >= RAGE_THRESHOLD) {
    rageTapBuckets.delete(elementKey);
    track("rage_tap", { element: elementKey, taps: kept.length });
    return;
  }
  rageTapBuckets.set(elementKey, kept);
}

export function markReturned() {
  if (!isBrowser()) return;
  try {
    const key = "kf.lastSeen";
    const now = Date.now();
    const last = Number(localStorage.getItem(key) ?? 0);
    localStorage.setItem(key, String(now));
    // Fire "app_returned" only if last visit was over 30 min ago.
    if (last && now - last > 30 * 60 * 1000) {
      track("app_returned", { minutes_away: Math.round((now - last) / 60000) });
    }
  } catch {
    // ignore
  }
}
