import { resolve } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  envDir: resolve(import.meta.dirname, "../../packages/env"),
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
    // Build only: Nitro's single-file bundle lacks takumi's `.wasm`, and dev cannot load the `next` entry.
    alias:
      command === "build"
        ? [{ find: /^takumi-pdf$/, replacement: "takumi-pdf/next" }]
        : [],
  },
  build: {
    // CSP is `font-src 'self'`, so fonts must never inline as data: URLs.
    assetsInlineLimit: 0,
  },
  environments: {
    ssr: {
      build: {
        rolldownOptions: {
          // Without this, mutually importing SSR chunks read helpers before assignment (TDZ 500).
          output: { strictExecutionOrder: true },
        },
      },
    },
  },
  plugins: [
    { enforce: "pre", ...mdx({ jsxImportSource: "react" }) },
    tailwindcss(),
    tanstackStart(),
    nitro({
      compressPublicAssets: { gzip: true, brotli: true },
      inlineDynamicImports: true,
    }),
    viteReact({ compiler: true }),
  ],
}));
