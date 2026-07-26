// KainFit service worker (2026-07-26) — minimal, on purpose.
//
// Scope: PWA installability + a graceful offline fallback shell only.
// This does NOT implement an offline-first app, and deliberately does not
// cache anything beyond one static HTML fallback page:
//
// - No API/Supabase response is ever cached (auth, profile, food entries,
//   analytics — none of it). Every non-navigation request passes straight
//   through to the network, untouched by this worker.
// - No mutating request (POST/PUT/PATCH/DELETE) is ever intercepted.
// - No authentication token or personal nutrition data is stored here.
// - Only a full-page navigation (GET, mode "navigate") ever falls back to
//   the cached offline page, and only when the network request itself
//   fails outright (the user has no connectivity) — a live network
//   response is always preferred and never overridden.
//
// If the product later needs real offline support (e.g. queued food
// entries), that is a deliberate, separately-reviewed feature — not
// something to grow out of this file silently.

const CACHE_NAME = "kainfit-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") {
    // Everything that isn't a top-level page navigation — including every
    // API call, asset, and Supabase request — is left completely
    // untouched by this worker.
    return;
  }
  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res ?? Response.error())),
  );
});
