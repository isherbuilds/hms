import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Read VITE_* from the monorepo's single .env instead of one next to this
  // app. The SSR half of the web app loads the same file through @hms/env.
  envDir: resolve(import.meta.dirname, "../../packages/env"),
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      // The Node preset serves `.output/public` itself in the container. Emit
      // precompressed variants so hashed JS/CSS/fonts do not cross the wire at
      // their full minified size when there is no compression-capable CDN in
      // front of the process.
      compressPublicAssets: { gzip: true, brotli: true },
    }),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
