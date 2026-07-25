// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      // Dev-server-only host allowlist (Vite's DNS-rebinding protection).
      // The leading dot allows any *.ts.net subdomain — a Tailscale tailnet
      // hostname, needed for real-device (iPhone/Android) testing over a
      // private tailnet — without hardcoding any one person's specific
      // tailnet name. Never affects production builds; `server.allowedHosts`
      // only applies to `vite dev`.
      allowedHosts: [".ts.net"],
    },
  },
});
