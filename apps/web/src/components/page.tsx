import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { SidebarTrigger } from "@hms/ui/components/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { cn } from "@hms/ui/lib/utils";
import { Link, createLink, type LinkOptions } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { memo, useEffect, useRef, type ComponentProps, type ReactNode, type Ref } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/orpc-error";

/**
 * The page's single 48 px title band. `description` is durable context — `MRN ·
 * Name` on a record, a short phrase elsewhere — never data that changes with the
 * view (docs/design.md §8). It stacks under the title inside the same band.
 */
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
    <div
      data-slot="page-header"
      className="z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3 lg:pr-4 lg:pl-6 print:h-auto print:px-4 print:py-3"
    >
      <SidebarTrigger className="print:hidden lg:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="min-w-0 truncate text-sm/5 font-medium">{title}</h1>
          {description && (
            <p className="min-w-0 truncate text-xs/4 text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

// A page should never set its own `p-*`; pass `bleed` for content that must reach
// the edge. `width` caps the content, not the scroller, so the scrollbar stays at the
// window edge.
export function PageBody({
  children,
  bleed = false,
  width,
  className,
}: {
  children?: ReactNode;
  bleed?: boolean;
  width?: string;
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
      {width ? (
        <div className={cn("mx-auto flex w-full flex-col gap-4", width)}>{children}</div>
      ) : (
        children
      )}
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
          "-mb-px flex min-h-10 gap-1 overflow-x-auto overflow-y-hidden px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {children}
      </div>
    </nav>
  );
}

// The anchor fills the strip and carries the underline, so the focus ring goes on
// the label inside it: rounded, padded, and clear of both strip rules.
export const PageTab = createLink(function PageTabAnchor({
  className,
  children,
  ref,
  ...props
}: ComponentProps<"a">) {
  return (
    <a
      ref={ref}
      className={cn(
        "flex shrink-0 items-center rounded-none border-b-2 border-transparent text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground data-[status=active]:border-foreground data-[status=active]:font-medium data-[status=active]:text-foreground",
        className,
      )}
      {...props}
    >
      <span data-focus-ring className="rounded-md px-2 py-1">
        {children}
      </span>
    </a>
  );
});

/**
 * One list, two shapes (docs/design.md §8). The same `columns` render a `Table`
 * at `md` and one compact row per record below it: the first column is the
 * row's name and carries its link or activation, `title` columns share its
 * line, the rest are joined with `·` beneath, `hidden` ones are dropped.
 * `action` is the right-aligned last column on the table and sits outside the
 * row target on the compact row.
 */
export type Column<T> = {
  head: ReactNode;
  cell: (row: T) => ReactNode;
  /** Heading and cell: alignment or width. Typography belongs in `cell`. */
  className?: string;
  mobile?: "title" | "hidden";
};

type DataListProps<T> = {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The route the row opens. */
  link?: (row: T) => LinkOptions;
  /** The overlay the row opens. */
  onActivate?: (row: T) => void;
  /** Row controls, rendered outside the row target. */
  action?: (row: T, busy: boolean) => ReactNode;
  /** Per-row pending state, read here so only that row re-renders while it saves. */
  busy?: (row: T) => boolean;
};

export function DataList<T>({
  columns,
  rows,
  rowKey,
  link,
  onActivate,
  action,
  busy,
}: DataListProps<T>) {
  const shape = (compact: boolean) =>
    rows.map((row) => (
      <DataRow
        key={rowKey(row)}
        row={row}
        compact={compact}
        columns={columns}
        link={link}
        onActivate={onActivate}
        action={action}
        busy={busy?.(row) ?? false}
      />
    ));

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={index} className={column.className}>
                  {column.head}
                </TableHead>
              ))}
              {action && <TableHead className="w-16 text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>{shape(false)}</TableBody>
        </Table>
      </div>
      <ul className="md:hidden">{shape(true)}</ul>
    </>
  );
}

// SAFETY: `memo` erases the type parameter; the cast restores the same generic signature the
// wrapped function declares, so every call site is still checked against its `T`.
const DataRow = memo(function DataRow<T>({
  row,
  compact,
  columns,
  link,
  onActivate,
  action,
  busy,
}: Omit<DataListProps<T>, "rows" | "rowKey" | "busy"> & {
  row: T;
  compact: boolean;
  busy: boolean;
}) {
  const target = (className: string, children: ReactNode) =>
    link ? (
      <Link
        {...link(row)}
        className={className}
        data-focus-floor={compact ? undefined : "off"}
        data-focus-inset
      >
        {children}
      </Link>
    ) : onActivate ? (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => onActivate(row)}
        className={cn("text-left", className)}
        data-focus-floor={compact ? undefined : "off"}
        data-focus-inset
      >
        {children}
      </button>
    ) : (
      children
    );

  const targeted = Boolean(link || onActivate);

  if (!compact) {
    return (
      <TableRow className={targeted ? "relative" : undefined}>
        {columns.map((column, index) => (
          <TableCell key={index} className={column.className}>
            {index === 0 && targeted
              ? target(
                  "font-medium underline-offset-4 after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-[2.5px] focus-visible:after:outline-offset-[-2.5px] focus-visible:after:outline-(--focus-ring) [@media(hover:hover)_and_(pointer:fine)]:hover:underline",
                  column.cell(row),
                )
              : column.cell(row)}
          </TableCell>
        ))}
        {action && <TableCell className="relative z-10 text-right">{action(row, busy)}</TableCell>}
      </TableRow>
    );
  }

  const [name, ...rest] = columns;
  const titles = rest.filter((column) => column.mobile === "title");
  const meta = rest.filter((column) => column.mobile === undefined);

  return (
    <li className="flex min-w-0 items-start border-b text-xs">
      {target(
        "flex min-h-10 min-w-0 flex-1 flex-col gap-1 px-3 py-2",
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium">{name.cell(row)}</span>
            {titles.map((column, index) => (
              <span key={index} className="shrink-0">
                {column.cell(row)}
              </span>
            ))}
          </span>
          {meta.length > 0 && (
            <span className="truncate text-muted-foreground">
              {meta.map((column, index) => (
                <span key={index}>
                  {index > 0 && " · "}
                  {column.cell(row)}
                </span>
              ))}
            </span>
          )}
        </>,
      )}
      {action && <div className="shrink-0 py-2 pr-3">{action(row, busy)}</div>}
    </li>
  );
}) as <T>(
  props: Omit<DataListProps<T>, "rows" | "rowKey" | "busy"> & {
    row: T;
    compact: boolean;
    busy: boolean;
  },
) => ReactNode;

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
  /** Omit on a single-list page: the table's column labels take the label row. */
  label?: string;
  action?: ReactNode;
  footer?: ReactNode;
  minHeight?: string;
  padded?: boolean;
  /** Fill the page: set on every page whose body is one list. */
  grow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col rounded-xl bg-muted p-1", grow && "flex-1")}>
      {label && (
        <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
          <h2 className="min-w-0 truncate">{label}</h2>
          {action}
        </div>
      )}
      <div
        className={cn(
          "flex flex-1 flex-col",
          label
            ? "overflow-hidden rounded-lg border border-border bg-card"
            : // The card starts under the header row, so the column labels sit on the tray
              // while staying in the rows' table and keeping their columns aligned.
              "relative isolate before:absolute before:inset-x-0 before:top-0 before:bottom-0 before:-z-10 before:rounded-lg before:border before:border-border before:bg-card md:before:top-8 [&_thead_tr]:border-0",
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
