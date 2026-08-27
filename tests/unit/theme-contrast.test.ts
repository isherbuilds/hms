import { expect, test } from "bun:test";

/**
 * The focus ring is the only thing telling a keyboard-driven desk where it is.
 * WCAG 2.4.11 / 1.4.11 put the floor for a non-text indicator at 3:1 against
 * every surface it can land on. This guards the token, in both themes, so the
 * floor cannot be lost to a palette tweak.
 */

const GLOBALS = new URL("../../packages/ui/src/styles/globals.css", import.meta.url);

/** Neutral oklch only (chroma 0): every surface token in this palette is grey. */
function parseNeutralTokens(block: string): Map<string, number> {
  const out = new Map<string, number>();
  const pattern = /(--[a-z-]+):\s*oklch\(([0-9.]+)\s+0\s+0\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    out.set(match[1]!, Number(match[2]!));
  }
  return out;
}

/**
 * For a neutral oklch colour the OKLab->linear-sRGB matrix collapses to
 * r = g = b = L^3, so WCAG relative luminance (0.2126R + 0.7152G + 0.0722B on
 * linear-light channels) is simply L^3. Derived from the formula, not from any
 * value the stylesheet asserts.
 */
const luminance = (lightness: number) => lightness ** 3;

const contrast = (a: number, b: number) => {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Anchored to a rule at the start of a line: a bare indexOf(".dark") finds the
 * `@custom-variant dark (&:is(.dark *))` declaration above and reads the wrong
 * block entirely.
 */
function blockFor(css: string, selector: string): string {
  const open = css.indexOf(`\n${selector} {`);
  expect(open, `no top-level "${selector} {" rule in globals.css`).toBeGreaterThanOrEqual(0);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

/** Every surface a ring can be drawn on top of. */
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
