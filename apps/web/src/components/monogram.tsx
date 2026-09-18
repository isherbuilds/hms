import { cn } from "@hms/ui/lib/utils";

export function Monogram({ label, tone = "muted" }: { label: string; tone?: "muted" | "accent" }) {
  const words = label.split(/[\s@._-]+/).filter(Boolean);

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-xs font-medium",
        tone === "accent" ? "bg-sidebar-accent text-sidebar-foreground" : "bg-card",
      )}
    >
      {(words[0]?.[0] ?? "?").concat(words[1]?.[0] ?? "").toUpperCase()}
    </span>
  );
}
