import { cn } from "@hms/ui/lib/utils";
import { SidebarTrigger } from "@hms/ui/components/sidebar";
import { type ReactNode } from "react";

import { errorMessage } from "@/lib/orpc-error";

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
    <div className="z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3 lg:pr-4 lg:pl-6 print:h-auto print:px-4 print:py-3">
      <SidebarTrigger className="print:hidden lg:hidden" />
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

// A page should never set its own `p-*`; pass `bleed` for content that must reach
// the edge.
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
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto text-xs print:overflow-visible",
        bleed ? "py-4" : "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

const RETRY_HINT = "The connection dropped. It will retry; reload if it stays empty.";

/**
 * How a page reports a read that failed. Pass the caught `error` and this words it:
 * a dropped connection has no sentence of its own, so printing `error.message` raw
 * puts "Failed to fetch" in front of an operator. Pass `detail` instead only for
 * wording the error cannot carry — what is stale, and what still works.
 */
export function ErrorNote({
  title,
  error,
  detail,
  inset = false,
}: {
  title: string;
  error?: unknown;
  detail?: ReactNode;
  inset?: boolean;
}) {
  const body = detail ?? (error === undefined ? undefined : errorMessage(error, RETRY_HINT));

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-1 border-l-2 border-destructive pl-3 text-xs",
        inset && "m-4",
      )}
    >
      <p className="font-medium">{title}</p>
      {body && <p className="text-muted-foreground">{body}</p>}
    </div>
  );
}
