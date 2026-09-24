// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/transactions-search-filter.tsx, invoice-search-filter.tsx,
// filter-list.tsx and date-range-filter.tsx: Radix → Base UI Menu, nuqs → router search params.
import { Button } from "@hms/ui/components/button";
import type { CalendarRange } from "@hms/ui/components/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { Popover, PopoverContent } from "@hms/ui/components/popover";
import { useIsMobile } from "@hms/ui/hooks/use-mobile";
import { ClientOnly } from "@tanstack/react-router";
import {
  CalendarIcon,
  ChevronDownIcon,
  ListFilterIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { datePresets, dateRangeLabel } from "@/lib/date-presets";
import { validateReportPeriod } from "@/lib/report-presentation";

// The menu of a filter button that has no search field to borrow its width from.
const MENU_WIDTH = "w-52";

// Keep react-day-picker out of every list route until the optional custom range opens.
const Calendar = lazy(() =>
  import("@hms/ui/components/calendar").then((module) => ({
    default: module.Calendar,
  })),
);

// Colour, not opacity, marks an active filter; nothing animates.
function filterTrigger(active: boolean, disabled: boolean) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Filters"
      disabled={disabled}
      data-active={active || undefined}
      className="text-muted-foreground data-active:text-foreground data-popup-open:text-foreground"
    >
      <ListFilterIcon data-icon="inline-start" />
    </Button>
  );
}

/**
 * The filter button inside the search field; its menu is exactly as wide as the field.
 * A list with no search field passes no `anchor`: the menu then hangs off the button
 * itself at a fixed width, opening inwards rather than back across the sidebar.
 */
export function FilterMenu({
  anchor,
  active,
  children,
}: {
  anchor?: RefObject<HTMLDivElement | null>;
  active: boolean;
  children: ReactNode;
}) {
  // Base UI popups stay behind ClientOnly; the server renders the same button, inert.
  return (
    <ClientOnly fallback={filterTrigger(active, true)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={filterTrigger(active, false)} />
        <DropdownMenuContent
          anchor={anchor}
          align={anchor ? "end" : "start"}
          className={anchor ? undefined : MENU_WIDTH}
        >
          <DropdownMenuGroup>{children}</DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

export function FilterSubmenu({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={`max-h-72 ${MENU_WIDTH}`}>
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Move focus to the search box before the focused control unmounts. `empty` clears the
 * text first: SearchInput never syncs a focused box, so a cleared `q` would
 * leave the old text on screen.
 */
export function focusSearch(
  field: RefObject<HTMLDivElement | null>,
  { empty = false } = {},
) {
  const box = field.current?.querySelector("input");

  if (!box) return;

  if (empty) box.value = "";

  box.focus();
}

/** One applied filter, labelled by the route that owns its names. */
export type ActiveFilter = {
  id: string;
  name: string;
  label: string;
  remove: () => Promise<void>;
};

/**
 * `onClear` must move focus itself (see focusSearch): Clear unmounts with the last chip.
 * `field` is the search box focus falls back to; a list without one passes nothing.
 */
export function FilterChips({
  filters,
  field,
  onClear,
}: {
  filters: ActiveFilter[];
  field?: RefObject<HTMLDivElement | null>;
  onClear: () => void;
}) {
  if (filters.length === 0) return null;

  return (
    <>
      <ul
        aria-label="Active filters"
        className="flex flex-wrap items-center gap-2"
      >
        {filters.map((filter) => (
          <li key={filter.id}>
            <button
              type="button"
              title={filter.label}
              aria-label={`Remove ${filter.name} filter: ${filter.label}`}
              className="inline-flex h-8 max-w-64 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
              onClick={(event) => {
                // The chip unmounts: keep keyboard focus on the next chip, else the field.
                const next = event.currentTarget
                  .closest("li")
                  ?.nextElementSibling?.querySelector("button");

                void filter.remove().then(() => {
                  if (next) next.focus();
                  else if (field) focusSearch(field);
                });
              }}
            >
              <span className="truncate">{filter.label}</span>
              <XIcon aria-hidden className="size-3.5 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </>
  );
}

/** Presets from the organization's business date, then a custom range prompt. */
function DateFilterItems({
  today,
  from,
  to,
  onChange,
  onCustom,
}: {
  today: string;
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  onCustom: () => void;
}) {
  const presets = datePresets(today);

  const custom =
    (from !== undefined || to !== undefined) &&
    !presets.some((each) => each.from === from && each.to === to);

  return (
    <>
      {presets.map((preset) => (
        <DropdownMenuCheckboxItem
          key={preset.id}
          checked={preset.from === from && preset.to === to}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? { from: preset.from, to: preset.to }
                : { from: undefined, to: undefined },
            )
          }
        >
          {preset.label}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      {/* An Item, not a CheckboxItem: it hands over to the calendar, so the menu closes
          behind it instead of staying open under the popover. */}
      <DropdownMenuItem onClick={onCustom}>
        {custom ? dateRangeLabel(today, from, to) : "Custom range…"}
      </DropdownMenuItem>
    </>
  );
}

/** The date range as a submenu of a search field's filter menu. */
export function DateSubmenu(props: {
  today: string;
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  onCustom: () => void;
}) {
  return (
    <FilterSubmenu icon={CalendarIcon} label="Date">
      <DateFilterItems {...props} />
    </FilterSubmenu>
  );
}

/**
 * The whole date filter for a list with no search field: a trigger that says the applied
 * range, its preset menu, and the calendar, all anchored to the same button. An icon
 * whose menu is the only thing on the toolbar hides what the page is showing.
 */
export function DateFilter({
  today,
  from,
  to,
  maxDays,
  onChange,
}: {
  today: string;
  from?: string;
  to?: string;
  /** The report's cap on an inclusive range; unset leaves the range unbounded. */
  maxDays?: number;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const button = (
    <Button ref={trigger} variant="outline">
      <CalendarIcon
        data-icon="inline-start"
        className="text-muted-foreground"
      />
      {dateRangeLabel(today, from, to)}
      <ChevronDownIcon
        data-icon="inline-end"
        className="text-muted-foreground"
      />
    </Button>
  );

  return (
    <>
      <ClientOnly fallback={button}>
        <DropdownMenu>
          <DropdownMenuTrigger render={button} />
          <DropdownMenuContent align="start" className={MENU_WIDTH}>
            <DropdownMenuGroup>
              <DateFilterItems
                today={today}
                from={from}
                to={to}
                onChange={onChange}
                onCustom={() => setCustomOpen(true)}
              />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ClientOnly>
      <DateRangePopover
        open={customOpen}
        onOpenChange={setCustomOpen}
        anchor={trigger}
        from={from}
        to={to}
        today={today}
        maxDays={maxDays}
        onApply={onChange}
      />
    </>
  );
}

// A business date names a day, so it converts by calendar fields, never through an
// instant: `new Date("2026-08-02")` is UTC midnight and reads back as 1 August west of
// Greenwich. The calendar stays in the browser's own frame and no day can shift.
function toDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year!, month! - 1, date!);
}

function toDay(date?: Date): string | undefined {
  if (!date) return undefined;

  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The custom range, picked on a month grid anchored to the control that opened it. Two
 * `type="date"` boxes in a dialog asked the operator to type what a calendar shows.
 */
export function DateRangePopover({
  open,
  onOpenChange,
  anchor,
  from,
  to,
  today,
  maxDays,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  from?: string;
  to?: string;
  today: string;
  maxDays?: number;
  onApply: (range: { from: string; to: string }) => void;
}) {
  return (
    <ClientOnly fallback={null}>
      <Popover open={open} onOpenChange={onOpenChange}>
        {/* A child owns the draft, so each open starts from the applied range. */}
        <PopoverContent
          anchor={anchor}
          align="start"
          aria-label="Custom range"
          className="w-auto p-0"
        >
          <DateRangeCalendar
            from={from}
            to={to}
            today={today}
            maxDays={maxDays}
            onApply={(range) => {
              onApply(range);
              onOpenChange(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </ClientOnly>
  );
}

function DateRangeCalendar({
  from,
  to,
  today,
  maxDays,
  onApply,
}: {
  from?: string;
  to?: string;
  today: string;
  maxDays?: number;
  onApply: (range: { from: string; to: string }) => void;
}) {
  const [draft, setDraft] = useState<CalendarRange | undefined>({
    from: from ? toDate(from) : undefined,
    to: to ? toDate(to) : undefined,
  });

  const months = useIsMobile() ? 1 : 2;
  const start = toDay(draft?.from);
  const end = toDay(draft?.to);
  // Only a complete draft can break the cap, so a half-picked range reads as guidance.
  const error = start && end ? validateReportPeriod(start, end, maxDays) : null;

  return (
    <div className="grid pb-2">
      <Suspense fallback={<div aria-hidden className="h-64 w-56 md:w-110" />}>
        <Calendar
          autoFocus
          mode="range"
          today={toDate(today)}
          // Two months, so a range that crosses a month boundary is one drag rather than
          // a click, a page turn, and a second click. One month once that will not fit.
          numberOfMonths={months}
          defaultMonth={toDate(from ?? to ?? today)}
          // No hospital record is dated after the organization's own business date.
          disabled={{ after: toDate(today) }}
          selected={draft}
          onSelect={setDraft}
        />
      </Suspense>
      <div className="mx-2 flex items-center gap-2 border-t border-border pt-2">
        <p
          className={`flex-1 ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {error ??
            (start ? dateRangeLabel(today, start, end) : "Pick the first day")}
        </p>
        <Button
          size="xs"
          disabled={!start || !end || error !== null}
          onClick={() => start && end && onApply({ from: start, to: end })}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
