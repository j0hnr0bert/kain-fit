// Production-runtime smoke test (Phase 11 regression guard).
//
// Why this exists: a production outage (SSR circular dependency ->
// "createMiddleware is not a function") shipped while lint, typecheck,
// tests and `vite build` were all green. Those checks never *boot* the
// built worker. This script does: it imports dist/server/index.mjs (the
// real deployed artifact) and drives real requests through its fetch
// handler, failing on any 5xx, thrown SSR error, or module-init crash.
//
// Usage: bun run build && bun run smoke

const ROUTES = [
  { path: "/", allow: [200] },
  { path: "/auth", allow: [200, 301, 302, 307, 308] },
  { path: "/demo", allow: [200] },
  { path: "/today", allow: [200, 301, 302, 307, 308] },
  { path: "/privacy", allow: [200] },
];

const ORIGIN = "https://smoke.local";

function loadEnvFile() {
  // The built worker reads Supabase config from process.env at request time.
  try {
    const text = require("node:fs").readFileSync(".env", "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env is optional in CI */
  }
}

const require = (await import("node:module")).createRequire(import.meta.url);
loadEnvFile();

let mod;
try {
  mod = await import("../dist/server/index.mjs");
} catch (err) {
  console.error("FAIL: built server module failed to load (SSR startup crash)");
  console.error(err);
  process.exit(1);
}

const handler = mod.default?.fetch ?? mod.fetch;
if (typeof handler !== "function") {
  console.error("FAIL: built server module exposes no fetch handler");
  process.exit(1);
}

const env = { ...process.env };
const ctx = { waitUntil() {}, passThroughOnException() {} };

let failed = 0;
for (const route of ROUTES) {
  const req = new Request(`${ORIGIN}${route.path}`, {
    headers: { "user-agent": "kainfit-prod-smoke/1.0", accept: "text/html" },
  });
  let res;
  try {
    res = await handler(req, env, ctx);
  } catch (err) {
    console.error(`FAIL ${route.path}: handler threw`, err);
    failed++;
    continue;
  }
  const ok = route.allow.includes(res.status);
  if (!ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 800);
    } catch {
      /* ignore */
    }
    console.error(`FAIL ${route.path}: ${res.status} (expected ${route.allow.join("/")})\n${body}`);
    failed++;
    continue;
  }
  if (res.status === 200) {
    const html = await res.text();
    if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
      console.error(`FAIL ${route.path}: 200 but no HTML document rendered`);
      failed++;
      continue;
    }
  }
  console.log(`PASS ${route.path} -> ${res.status}`);
}

if (failed > 0) {
  console.error(`\nproduction-runtime smoke test FAILED (${failed} route(s))`);
  process.exit(1);
}
console.log("\nproduction-runtime smoke test PASSED");
