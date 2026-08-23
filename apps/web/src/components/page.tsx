import { cn } from "@hms/ui/lib/utils";
import { type ReactNode } from "react";

/**
 * Page chrome. These own every spacing decision a page would otherwise make for
 * itself, which is what keeps two screens built months apart looking like the
 * same product. See `docs/design.md`.
 */

/** Title, optional description, and optional action for one page. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          {description && (
            <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
              {description}
            </p>
          )}
        </div>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

/**
 * The standard page container: one padding value, one gap, one column. A page
 * should never set its own `p-*` — if the content needs to bleed to the edge
 * (a full-width table), pass `bleed`.
 */
export function PageBody({
  children,
  bleed = false,
  className,
}: {
  children?: ReactNode;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 text-xs", bleed ? "py-4" : "p-4", className)}>
      {children}
    </div>
  );
}

/**
 * The one way a page reports a failed read. It repeated verbatim in seven pages
 * with three different outer margins before it became a component — which is
 * exactly the signal the convention doc describes.
 */
export function ErrorNote({
  title,
  detail,
  inset = false,
}: {
  title: string;
  detail?: ReactNode;
  inset?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-1 border-l-2 border-destructive pl-3 text-xs",
        inset && "m-4",
      )}
    >
      <p className="font-medium">{title}</p>
      {detail && <p className="text-muted-foreground">{detail}</p>}
    </div>
  );
}
