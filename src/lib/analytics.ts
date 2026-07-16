// Client-side analytics helper.
// - Reads ?source= from the URL on first load and persists it for the session.
// - Maintains a stable anonymous session id in localStorage.
// - Sends events to the server via `trackEvent` server function.
// - Fails silently (no user-facing errors, no throws).

import { trackEvent } from "./beta.functions";

const SESSION_KEY = "kf.sid";
const SOURCE_KEY = "kf.src";

function isBrowser() {
  return typeof window !== "undefined";
}

function readSource(): string | null {
  if (!isBrowser()) return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("source");
    if (fromUrl) {
      sessionStorage.setItem(SOURCE_KEY, fromUrl.slice(0, 64));
      return fromUrl.slice(0, 64);
    }
    return sessionStorage.getItem(SOURCE_KEY);
  } catch {
    return null;
  }
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
  | "admin_dashboard_viewed";

export function track(event: EventName, properties: Record<string, unknown> = {}): void {
  if (!isBrowser()) return;
  const now = Date.now();
  const last = lastSent.get(event) ?? 0;
  if (now - last < 1000) return;
  lastSent.set(event, now);

  const sid = getSessionId();
  const source = readSource();
  const props: Record<string, unknown> = {
    device_category: deviceCategory(),
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