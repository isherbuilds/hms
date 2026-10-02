/* Renders one Open Graph card per PUBLIC_ROUTES entry into apps/web/public/og/.
   Run by a person when a public page is added or retitled; the output is
   committed. Four pages do not justify a request-time route and its cache; the
   same ImageResponse call moves into a server route when arbitrary titles arrive.

   Usage: bun scripts/generate-og.ts */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { container, text } from "takumi-js/helpers";
import { Renderer } from "takumi-js/node";
import { ImageResponse } from "takumi-js/response";

import { WASH_BACKGROUND } from "../apps/web/src/components/landing/wash";
import { OG_IMAGE, PUBLIC_ROUTES, siteConfig } from "../apps/web/src/config/site";

const started = performance.now();

// The site's own Inter, not a system face: a probe without a registered font
// silently fell back to whatever the machine had.
const inter = resolve(
  import.meta.dirname,
  "../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);

const renderer = new Renderer();

await renderer.registerFont({ name: "Inter", data: await Bun.file(inter).bytes() });

// The ink pinned for anything drawn on the wash (`ON_WASH` in wash.tsx).
const INK = "oklch(0.145 0 0)";

const outDir = resolve(import.meta.dirname, "../apps/web/public/og");

await mkdir(outDir, { recursive: true });

for (const route of PUBLIC_ROUTES) {
  const card = container({
    style: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      width: "100%",
      height: "100%",
      padding: "72px 80px",
      background: WASH_BACKGROUND,
      fontFamily: "Inter",
      color: INK,
    },
    children: [
      text(siteConfig.name, { fontSize: 32, fontWeight: 500 }),
      text(route.title, {
        fontSize: 72,
        fontWeight: 500,
        lineHeight: 1.05,
        letterSpacing: "-0.02em",
      }),
    ],
  });

  const response = new ImageResponse(card, { renderer, ...OG_IMAGE, format: "png" });
  await Bun.write(
    resolve(outDir, route.ogImage.replace(/^\/og\//, "")),
    await response.arrayBuffer(),
  );
  console.log(`${route.ogImage} ← ${route.title}`);
}

console.log(`${PUBLIC_ROUTES.length} images in ${Math.round(performance.now() - started)} ms`);
