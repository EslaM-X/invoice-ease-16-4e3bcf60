// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  // Route SSR through our wrapper (src/server.ts) so module-init failures and
  // h3-swallowed handler errors return a friendly HTML page instead of
  // {"unhandled":true,"message":"HTTPError"}.
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [mcpPlugin()],
});
