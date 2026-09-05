import { expect, test } from "bun:test";

// `@hms/env/web` validates at import time, so the origin must be set before the
// module loads; a static import would hoist above the assignment.
process.env.VITE_SERVER_URL ??= "https://api.hms.example";
process.env.VITE_WEB_URL = "https://hms.example";
process.env.VITE_WHATSAPP_NUMBER ??= "919999999999";
process.env.VITE_CONTACT_EMAIL ??= "hello@hms.example";
const { pageHead } = await import("../../apps/web/src/lib/seo");

test("the landing page head carries the complete Open Graph contract with absolute URLs", () => {
  const { meta, links } = pageHead({ path: "/" });
  const byKey = Object.fromEntries(
    meta.map((tag) => [
      "title" in tag ? "title" : "property" in tag ? tag.property : tag.name,
      "title" in tag ? tag.title : tag.content,
    ]),
  );

  expect(byKey.title).toBe("HMS — the desk software your hospital actually runs on");
  expect(byKey.description).toBeString();
  expect(byKey["og:type"]).toBe("website");
  expect(byKey["og:site_name"]).toBe("HMS");
  expect(byKey["og:title"]).toBe(byKey.title);
  expect(byKey["og:description"]).toBe(byKey.description);
  expect(byKey["og:url"]).toBe("https://hms.example/");
  expect(byKey["og:image"]).toBe("https://hms.example/og/home.png");
  expect(byKey["og:image:width"]).toBe("1200");
  expect(byKey["og:image:height"]).toBe("630");
  expect(byKey["og:image:alt"]).toBe(byKey.title);
  expect(byKey["twitter:card"]).toBe("summary_large_image");
  expect(links).toEqual([{ rel: "canonical", href: "https://hms.example/" }]);
});

test("an unlisted path cannot ship a head", () => {
  expect(() => pageHead({ path: "/not-public" })).toThrow();
});
