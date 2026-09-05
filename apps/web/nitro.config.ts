import evlog from "evlog/nitro/v3";
import { defineConfig } from "nitro";

export default defineConfig({
  preset: "bun",
  // Nitro 3 scans nothing by default; this registers server/middleware and server/plugins.
  serverDir: "./server",
  // Static headers here so hashed assets get them too; CSP and HSTS derive from
  // runtime env and live in server/middleware/security-headers.ts.
  routeRules: {
    "/**": {
      headers: {
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
      },
    },
  },
  experimental: {
    asyncContext: true,
  },
  modules: [
    evlog({
      env: { service: "hms-web" },
    }),
  ],
});
