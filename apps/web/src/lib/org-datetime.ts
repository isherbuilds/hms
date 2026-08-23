import { getRouteApi } from "@tanstack/react-router";

const orgRoute = getRouteApi("/$orgSlug");

/**
 * Timestamps render in the organization's timezone, not the browser's, so a
 * clinic in Delhi and a doctor logged in from Dubai read the same queue times
 * (decision D008). The org layout loader resolves the zone once per navigation and
 * every helper here takes it explicitly — no hidden context, no wrapper types.
 *
 * Two kinds of value live here and they are not interchangeable:
 *   - an *instant* (`createdAt`) is a point in time, formatted in the org zone;
 *   - a *business date* (`YYYY-MM-DD`) is a label for a day, formatted in UTC
 *     so it never slides into the day before or after.
 */

// Constructing an Intl.DateTimeFormat costs far more than using one, and a
// table formats a whole column. Cache per style+zone in a plain Map rather than
// useMemo: loaders and the server call these too, outside any React render.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  key: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = formatters.get(key);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, created);
  return created;
}

/** An instant as the org-local `datetime-local` input value. */
export function localInputValue(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The next half-hour boundary as an org-local `datetime-local` value. */
export function nextHalfHour(timeZone: string): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);
  return localInputValue(date, timeZone);
}

/** "12 Aug 2026, 4:05 pm" — an instant, in tables and detail views. */
export function formatDateTime(value: string | Date, timeZone: string): string {
  return formatter(`dateTime|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

/** "12 Aug 2026" — an instant where the time of day is noise. */
export function formatDate(value: string | Date, timeZone: string): string {
  return formatter(`date|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

/** "4:05 pm" — same-day operational rows such as queue tokens. */
export function formatTime(value: string | Date, timeZone: string): string {
  return formatter(`time|${timeZone}`, "en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

/**
 * "12 Aug" — a `YYYY-MM-DD` business date, for chart axes and day captions.
 * Pinned to UTC because the input names a day, not a moment: formatting it in
 * the org zone would shift a midnight anchor onto the neighbouring date.
 */
export function formatDay(day: string): string {
  return formatter("day|UTC", "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** "12 Aug 2026" — a complete `YYYY-MM-DD` business date. */
export function formatBusinessDate(day: string): string {
  return formatter("businessDate|UTC", "en-IN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Today's business date as `YYYY-MM-DD`. `en-CA` is the shortest way to get
 * that shape out of Intl without reassembling the parts by hand.
 */
export function orgToday(timeZone: string, now = new Date()): string {
  return formatter(`isoDate|${timeZone}`, "en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** First of the current month through today — the default report range. */
export function orgMonthToDate(timeZone: string): { from: string; to: string } {
  const to = orgToday(timeZone);
  return { from: `${to.slice(0, 8)}01`, to };
}

/**
 * The org's timezone and its current business date, both resolved by the
 * layout loader so server and client agree across a hydration.
 */
export function useOrgDateTime(): { timeZone: string; today: string } {
  return orgRoute.useLoaderData();
}
