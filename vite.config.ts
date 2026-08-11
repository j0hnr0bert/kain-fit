// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// mcpPlugin() (@lovable.dev/mcp-js/stacks/tanstack/vite) is deliberately NOT
// registered here — see the P0 outage postmortem. It generates the /mcp,
// /.mcp/list-tools, /.mcp/invoke-tool/$tool, and /.well-known/oauth-
// protected-resource routes (src/routes/mcp.ts and siblings) and wires
// src/lib/mcp/index.ts's defineMcp()/auth.oauth.issuer() into every one of
// them. Re-enabling requires re-adding this plugin AND restoring those
// route files from git history (see the commit that removed them) —
// verify against the actual Cloudflare Workers runtime (not just a local
// build) before doing so, since that's the gap that let this ship broken.
export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
