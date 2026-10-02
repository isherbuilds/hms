import type { CSSProperties, ReactNode } from "react";

/* Shared pieces of the public site. Every section composes these so a button
   or a status pill reads the same everywhere on the page. */

/* The `--i` stagger index the reveal and entrance motion read (index.css),
   merged with any other inline style an element needs. */
export function stagger(index: number, style: CSSProperties = {}): CSSProperties {
  // SAFETY: `--i` is a CSS custom property; React passes custom properties
  // through unchanged, but `CSSProperties` has no index signature for them.
  return { ...style, "--i": index } as CSSProperties;
}

/* Public-site buttons: taller and looser than the app's `Button` because a
   marketing ask is read once, not clicked all day. Press feedback is a 0.97
   scale; hover colour is gated to fine pointers. */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium no-underline transition-[transform,background-color,opacity] duration-150 ease-out active:scale-[0.97] [&_svg]:size-4.5 [&_svg]:shrink-0";

const BUTTON_SIZE = {
  md: "min-h-12 px-5.5 text-base",
  sm: "min-h-10 px-4 text-sm",
} as const;

/* Each variant owns its border colour: a transparent one in the base would
   compete with the variant's on equal specificity. */
const BUTTON_VARIANT = {
  /* Ink: the one action a section asks for. */
  primary: "border-transparent bg-foreground text-background pointer-fine:hover:opacity-85",
  secondary: "border-muted-foreground/50 bg-card text-foreground pointer-fine:hover:bg-muted",
  ghost: "border-transparent bg-transparent text-foreground pointer-fine:hover:bg-muted",
  /* On a dark band. */
  light: "border-transparent bg-band-foreground text-band pointer-fine:hover:opacity-90",
  "outline-light":
    "border-band-muted/60 bg-transparent text-band-foreground pointer-fine:hover:bg-band-raised",
} as const;

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  className?: string;
} = {}) {
  return `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`;
}

/* Emphasised words inside a heading carry the brand green. `onBand` switches to
   the brighter green a dark band needs. */
export function Accent({ children, onBand = false }: { children: ReactNode; onBand?: boolean }) {
  return (
    <em className={`not-italic ${onBand ? "text-brand-bright" : "text-brand"}`}>{children}</em>
  );
}

export const SECTION_HEADING =
  "text-4xl font-semibold tracking-[0.01em] [word-spacing:0.02em] text-balance md:text-5xl md:leading-14";

/* Size only; the section supplies the colour (muted on the page, band-muted on a band). */
export const LEDE = "text-lg md:text-xl md:leading-8";

/* The small uppercase label above a figure, a step or a column. */
export const EYEBROW = "text-xs font-semibold tracking-[0.08em] uppercase";

export const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

/* The heading every content section opens with. */
export function SectionHead({ title }: { title: ReactNode }) {
  return (
    <h2 data-reveal className={`${SECTION_HEADING} mb-10 md:mb-16`}>
      {title}
    </h2>
  );
}

/* Ward 3's bed map at the nurse station. */
const BED_TONE = {
  occupied: "bg-foreground text-background",
  free: "bg-brand-surface text-brand ring-1 ring-brand-border ring-inset",
  cleaning: "bg-clinical-note-surface text-clinical-note",
  discharging: "bg-muted text-muted-foreground",
} as const;

/* Every bed not listed here is occupied. */
const BED_STATUS: Record<number, keyof typeof BED_TONE> = {
  1: "free",
  3: "free",
  5: "free",
  9: "free",
  11: "free",
  17: "free",
  2: "discharging",
  6: "discharging",
  7: "cleaning",
  20: "cleaning",
};

/* Beds past the eighteenth only fit from `md`. */
export function Beds({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 md:grid-cols-8">
      {Array.from({ length: count }, (_, index) => {
        const status = BED_STATUS[index] ?? "occupied";

        return (
          <span
            key={index}
            aria-label={`Bed ${301 + index}, ${status}`}
            style={stagger(index)}
            className={`rounded-md pt-[7px] pb-1.5 text-center text-xs font-medium tabular-nums ${BED_TONE[status]} ${index >= 18 ? "max-md:hidden" : ""}`}
          >
            {301 + index}
          </span>
        );
      })}
    </div>
  );
}

/* A status pill with its dot. The word is always present; colour only
   reinforces it. `live` adds a slow breathing ring to the dot. */
const PILL_TONE = {
  neutral: "bg-muted text-foreground",
  ok: "bg-brand-surface text-brand",
  warn: "bg-clinical-note-surface text-clinical-note",
  danger: "bg-clinical-alert-surface text-clinical-alert",
} as const;

const PILL_SIZE = {
  sm: "gap-1.5 rounded-md px-2 text-xs leading-5",
  lg: "gap-2 rounded-lg px-3 text-base leading-8",
} as const;

export function Pill({
  tone = "neutral",
  live = false,
  size = "sm",
  children,
}: {
  tone?: keyof typeof PILL_TONE;
  live?: boolean;
  size?: "sm" | "lg";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap font-medium tabular-nums ${PILL_SIZE[size]} ${PILL_TONE[tone]}`}
    >
      <span
        aria-hidden
        className={`relative rounded-full bg-current ${size === "lg" ? "size-2" : "size-1.5"} ${live ? "after:absolute after:-inset-[3px] after:animate-[landing-live_2s_ease-in-out_infinite] after:rounded-full after:bg-current after:opacity-20" : ""}`}
      />
      {children}
    </span>
  );
}
