import { cn } from "@hms/ui/lib/utils";

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
