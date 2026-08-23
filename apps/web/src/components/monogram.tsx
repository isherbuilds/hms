import { cn } from "@hms/ui/lib/utils";

/**
 * The initials square that stands in for a picture we do not have — an
 * organization logo, a staff photo, a patient's face. It existed twice with two
 * different sizes before it became a component, which is the signal the design
 * doc describes.
 */
export function initials(value: string) {
  const words = value.split(/[\s@._-]+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").concat(words[1]?.[0] ?? "").toUpperCase();
}

export function Monogram({
  label,
  tone = "muted",
  className,
}: {
  label: string;
  /** `accent` is for the one identity that anchors a surface — the active org. */
  tone?: "muted" | "accent";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-xs font-medium",
        tone === "accent" ? "bg-sidebar-accent text-sidebar-foreground" : "bg-card",
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}
