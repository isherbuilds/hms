import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { SidebarTrigger } from "@hms/ui/components/sidebar";
import { cn } from "@hms/ui/lib/utils";
import { createLink } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, type ComponentProps, type ReactNode, type Ref } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/orpc-error";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      data-slot="page-header"
      className="z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3 lg:pr-4 lg:pl-6 print:h-auto print:px-4 print:py-3"
    >
      <SidebarTrigger className="print:hidden lg:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
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
      data-slot="page-body"
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

/**
 * One titled band of a full-page form. The card owns the border; the last section
 * drops its own so the card's rounded edge is not cut by a line.
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-border p-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-medium">{title}</h2>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ListToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchInput({
  label,
  placeholder,
  value,
  delay = 300,
  onQueryChange,
  fieldRef,
  trailing,
}: {
  label: string;
  placeholder: string;
  /** The applied query from the URL, so a reload shows what filters the list. */
  value?: string;
  /** 300 ms for a server-searched list, 150 ms for an in-memory master list. */
  delay?: number;
  /** The trimmed text; an empty string clears the search. */
  onQueryChange: (query: string) => void;
  fieldRef?: Ref<HTMLDivElement>;
  /** The filter trigger, drawn inside the field's right edge. */
  trailing?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The list re-renders after each pause, not after each keystroke.
  const apply = useDebouncedCallback((text: string) => onQueryChange(text.trim()), delay);

  // Clear, Back, or a link changes the URL; the box follows, but never while the
  // operator types in it.
  useEffect(() => {
    const element = input.current;

    if (!element) return;

    const applied = value ?? "";

    if (document.activeElement !== element) element.value = applied;

    // The box now shows the applied query, so a pause scheduled before it holds stale
    // text: Clear empties the box itself, and its pending pause would write `q` back.
    if (element.value.trim() === applied) apply.cancel();
  }, [value]);

  return (
    <div ref={fieldRef} className="relative w-full sm:w-88">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        defaultValue={value}
        // The server's query cap: a longer query would validate to no search.
        maxLength={100}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "pl-8",
          trailing !== undefined && "pr-8 [&::-webkit-search-cancel-button]:appearance-none",
        )}
        onChange={(event) => apply(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;

          if (event.key === "Enter") {
            event.preventDefault();
            apply.now(event.currentTarget.value);
          }

          // Esc clears the text only; filters never clear on Esc.
          if (event.key === "Escape" && event.currentTarget.value) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.value = "";
            apply.now("");
          }
        }}
      />
      {trailing === undefined ? null : (
        <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
      )}
    </div>
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
    /** Only the first load: a failed refetch keeps the rows it already painted. */
    isLoadingError: boolean;
    error: unknown;
    refetch: () => void;
  };
  errorTitle: string;
  /** Explicit, so a message can never paint over real rows. */
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  if (query.isPending) return null;

  if (query.isLoadingError) {
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
    isFetchNextPageError: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => void;
  };
  shown: number;
}) {
  if (shown === 0) return null;

  if (query.isFetchNextPageError) {
    return (
      <div
        role="alert"
        className="flex h-9 items-center justify-between gap-2 px-3 text-destructive"
      >
        <span>Could not load more</span>
        <Button variant="outline" size="xs" onClick={() => void query.fetchNextPage()}>
          Try again
        </Button>
      </div>
    );
  }

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
