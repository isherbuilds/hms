import { cn } from "@hms/ui/lib/utils";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Page chrome. These own every spacing decision a page would otherwise make for
 * itself, which is what keeps two screens built months apart looking like the
 * same product. See `docs/design.md`.
 */

/**
 * The shell publishes its header node here and `PageHeader` portals into it, so
 * the title sits in the app bar instead of costing a second band of chrome
 * below it. Null outside the shell (public pages), where `PageHeader` falls
 * back to rendering in place.
 */
export const PageHeaderSlot = createContext<HTMLElement | null>(null);

/** Title, optional description, optional action — rendered into the app bar. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const slot = useContext(PageHeaderSlot);
  const [mounted, setMounted] = useState(false);

  // The portal target only exists after the shell has mounted; until then the
  // header renders in place so the page is never headerless.
  useEffect(() => setMounted(true), []);

  const content = (
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
  );

  if (!mounted || !slot) {
    return (
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">{content}</div>
    );
  }
  return createPortal(content, slot);
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
  children: ReactNode;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 text-xs", bleed ? "py-4" : "p-4", className)}>
      {children}
    </div>
  );
}

/** A titled block within a page: heading, optional hint, then content. */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
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
        "flex flex-col gap-0.5 border-l-2 border-destructive pl-3 text-xs",
        inset && "m-4",
      )}
    >
      <p className="font-medium">{title}</p>
      {detail && <p className="text-muted-foreground">{detail}</p>}
    </div>
  );
}
