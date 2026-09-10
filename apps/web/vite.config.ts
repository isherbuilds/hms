import { resolve } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // The monorepo's single .env, which the SSR half also loads through @hms/env.
  envDir: resolve(import.meta.dirname, "../../packages/env"),
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
    // The Bun preset picks takumi's `bun` export, which reads the `.wasm` from disk
    // beside the module; Nitro's single-file bundle has no such file (ENOENT
    // `[object WebAssembly.Module]`). The `next` entry embeds it. Top-level, not
    // `environments.ssr`: the SSR chunk leaves the package external and Nitro's
    // own environment resolves it again.
    alias: [{ find: /^takumi-pdf$/, replacement: "takumi-pdf/next" }],
  },
  build: {
    // CSP is `font-src 'self'`; the default 4 KiB threshold inlined a small
    // JetBrains Mono subset as a data: URL, which the browser then blocked.
    assetsInlineLimit: 0,
  },
  environments: {
    ssr: {
      build: {
        rolldownOptions: {
          // The SSR graph splits into mutually importing chunks; without this the
          // runtime helpers are read before their chunk assigns them (TDZ 500).
          output: { strictExecutionOrder: true },
        },
      },
    },
  },
  plugins: [
    // Changelog entries are `.mdx` under `src/content/`; compiled to JSX before
    // the React plugin sees them, so `enforce: "pre"`.
    { enforce: "pre", ...mdx({ jsxImportSource: "react" }) },
    tailwindcss(),
    tanstackStart(),
    nitro({
      // The Bun preset serves `.output/public` itself, so precompress hashed assets for
      // deployments with no compression-capable CDN in front.
      compressPublicAssets: { gzip: true, brotli: true },
      inlineDynamicImports: true,
    }),
    // React Compiler runs natively through oxc-transform-react (Rust), not Babel.
    // Still marked experimental upstream — if memoization ever looks wrong, drop
    // back to `viteReact()` plus @rolldown/plugin-babel + reactCompilerPreset().
    viteReact({ compiler: true }),
  ],
});
