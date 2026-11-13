import { getRouteApi } from "@tanstack/react-router";

import { dateLabel, dayMonthLabel, dayParts } from "./business-date";

export { formatBusinessDate } from "./business-date";

const orgRoute = getRouteApi("/$orgSlug");

// An *instant* (`createdAt`) is a point in time, formatted in the org zone. A
// *business date* (`YYYY-MM-DD`) labels a day and is formatted in UTC, so it never
// slides into the day before or after. The two are not interchangeable (D008).

// Constructing an Intl.DateTimeFormat costs far more than using one. A plain Map,
// not useMemo: loaders and the server call these outside any React render.
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

export function nextHalfHour(timeZone: string): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);

  return localInputValue(date, timeZone);
}

/**
 * An instant's wall-clock numbers in the org zone. Only digits come from Intl; the
 * words are assembled from constants (see business-date.ts) so server and browser agree.
 */
function zonedParts(value: string | Date, timeZone: string) {
  const parts = formatter(`parts|${timeZone}`, "en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));

  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((each) => each.type === type);

    if (!found) throw new RangeError(`No ${type} in the formatted instant ${String(value)}`);

    return Number(found.value);
  };

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function dateOf(parts: ReturnType<typeof zonedParts>): string {
  return dateLabel(parts.year, parts.month, parts.day);
}

// en-IN's 12-hour clock: `12:00 am` at midnight, `12:00 pm` at noon, no leading zero.
function timeOf({ hour, minute }: ReturnType<typeof zonedParts>): string {
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** `13 Nov 2026, 2:59 am` */
export function formatDateTime(value: string | Date, timeZone: string): string {
  const parts = zonedParts(value, timeZone);

  return `${dateOf(parts)}, ${timeOf(parts)}`;
}

/** `13 Nov 2026` */
export function formatDate(value: string | Date, timeZone: string): string {
  return dateOf(zonedParts(value, timeZone));
}

/** `2:59 am` */
export function formatTime(value: string | Date, timeZone: string): string {
  return timeOf(zonedParts(value, timeZone));
}

/**
 * `4 Sept`. The input names a day, not a moment, so it is read as written rather than
 * placed in the org zone, which would shift it onto the neighbouring date.
 */
export function formatDay(day: string): string {
  const parts = dayParts(day);

  return dayMonthLabel(parts.month, parts.day);
}

// `en-CA` is the shortest way to get `YYYY-MM-DD` out of Intl.
export function orgToday(timeZone: string, now = new Date()): string {
  return formatter(`isoDate|${timeZone}`, "en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function orgMonthToDate(timeZone: string): { from: string; to: string } {
  const to = orgToday(timeZone);

  return { from: `${to.slice(0, 8)}01`, to };
}

// Both resolved by the layout loader, so server and client agree across hydration.
export function useOrgDateTime(): { timeZone: string; today: string } {
  return orgRoute.useLoaderData();
}
