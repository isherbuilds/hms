import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SidebarTrigger } from "@hms/ui/components/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@hms/ui/components/toggle-group";
import { cn } from "@hms/ui/lib/utils";
import { createLink } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
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

export function PageTabs({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  // The row, not each tab, overlaps the border by 1px: a tab hanging out of a
  // scroll container would give the strip a scrollbar of its own.
  return (
    <nav aria-label={label} className="shrink-0 border-b border-border print:hidden">
      <div
        className={cn(
          "-mb-px flex min-h-10 gap-1 overflow-x-auto overflow-y-hidden px-4",
          className,
        )}
      >
        {children}
      </div>
    </nav>
  );
}

export const PageTab = createLink(function PageTabAnchor({
  className,
  ref,
  ...props
}: ComponentProps<"a">) {
  return (
    <a
      ref={ref}
      className={cn(
        "flex shrink-0 items-center border-b-2 border-transparent px-2 text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground data-[status=active]:border-foreground data-[status=active]:font-medium data-[status=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
});

export function ListToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchInput({
  label,
  placeholder,
  onQueryChange,
  className,
}: {
  label: string;
  placeholder: string;
  onQueryChange: (query: string) => void;
  className?: string;
}) {
  // The list re-renders after each pause, not after each keystroke.
  const handleChange = useDebouncedCallback(onQueryChange, 300);

  return (
    <div className={cn("relative w-full max-w-md", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        className="pl-8"
        onChange={(event) => handleChange(event.currentTarget.value.trim())}
      />
    </div>
  );
}

export function FilterGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      size="sm"
      spacing={1}
      className="bg-muted p-0.5"
      onValueChange={(next) => {
        const nextValue = next[0] as T | undefined;
        if (nextValue !== undefined) onValueChange(nextValue);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** One-of-N list filter whose options come from data or run past five. */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value as T)}
      className="w-44"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

export function Panel({
  label,
  action,
  footer,
  minHeight = "min-h-32",
  padded = false,
  grow = false,
  className,
  children,
}: {
  label: string;
  action?: ReactNode;
  footer?: ReactNode;
  minHeight?: string;
  padded?: boolean;
  /** Fill the page: the one list on an operational desk, not a settings tray. */
  grow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col rounded-xl bg-muted p-1", grow && "flex-1")}>
      <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
        <h2 className="min-w-0 truncate">{label}</h2>
        {action}
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card",
          minHeight,
          padded && "gap-3 p-4",
          className,
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-3 text-center text-muted-foreground">
      {children}
    </div>
  );
}

export function ListState({
  query,
  errorTitle,
  isEmpty,
  empty,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  errorTitle: string;
  /** Explicit, so a message can never paint over real rows. */
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  if (query.isPending) return null;

  if (query.isError) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 p-4">
        <ErrorNote title={errorTitle} error={query.error} />
        <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (isEmpty) return <PanelEmpty>{empty}</PanelEmpty>;

  return children;
}

export function LoadMore({
  query,
  shown,
}: {
  query: {
    isError: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
  shown: number;
}) {
  if (shown === 0 || query.isError) return null;

  return (
    <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
      <span className="tabular-nums">
        {query.hasNextPage ? `${shown} shown` : `All ${shown} shown`}
      </span>
      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
