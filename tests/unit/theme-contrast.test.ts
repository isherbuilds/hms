import { expect, test } from "bun:test";

const GLOBALS = new URL("../../packages/ui/src/styles/globals.css", import.meta.url);

function parseNeutralTokens(block: string): Map<string, number> {
  const out = new Map<string, number>();
  const pattern = /(--[a-z-]+):\s*oklch\(([0-9.]+)\s+0\s+0\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    out.set(match[1]!, Number(match[2]!));
  }
  return out;
}

// For a neutral oklch colour the OKLab->linear-sRGB matrix collapses to
// r = g = b = L^3, so WCAG relative luminance is simply L^3.
const luminance = (lightness: number) => lightness ** 3;

const contrast = (a: number, b: number) => {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
};

// Anchored to a line start: a bare indexOf(".dark") finds the `@custom-variant`
// declaration above and reads the wrong block.
function blockFor(css: string, selector: string): string {
  const open = css.indexOf(`\n${selector} {`);
  expect(open, `no top-level "${selector} {" rule in globals.css`).toBeGreaterThanOrEqual(0);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

const SURFACES = ["--background", "--card", "--muted", "--sidebar"] as const;

test.each([
  [":root", "light"],
  [".dark", "dark"],
])("%s: the focus ring clears 3:1 on every surface it lands on", async (selector) => {
  const css = await Bun.file(GLOBALS).text();
  const tokens = parseNeutralTokens(blockFor(css, selector));

  for (const ringToken of ["--ring", "--sidebar-ring"]) {
    const ring = tokens.get(ringToken);
    expect(ring, `${selector} ${ringToken} must be a neutral oklch`).toBeDefined();

    for (const surfaceToken of SURFACES) {
      const surface = tokens.get(surfaceToken);
      expect(surface, `${selector} ${surfaceToken} must be a neutral oklch`).toBeDefined();

      const ratio = contrast(ring!, surface!);
      expect(
        Number(ratio.toFixed(2)),
        `${selector} ${ringToken} on ${surfaceToken} is ${ratio.toFixed(2)}:1, below the 3:1 floor`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

test.each([
  [":root", "light"],
  [".dark", "dark"],
])("%s: muted text clears 4.5:1 on every supporting surface", async (selector) => {
  const css = await Bun.file(GLOBALS).text();
  const tokens = parseNeutralTokens(blockFor(css, selector));
  const foreground = tokens.get("--muted-foreground");
  expect(foreground, `${selector} --muted-foreground must be a neutral oklch`).toBeDefined();

  for (const surfaceToken of ["--background", "--card", "--muted"]) {
    const surface = tokens.get(surfaceToken);
    expect(surface, `${selector} ${surfaceToken} must be a neutral oklch`).toBeDefined();

    const ratio = contrast(foreground!, surface!);
    expect(
      Number(ratio.toFixed(2)),
      `${selector} --muted-foreground on ${surfaceToken} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
