import { getRouteApi } from "@tanstack/react-router";

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

export function formatDateTime(value: string | Date, timeZone: string): string {
  return formatter(`dateTime|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatDate(value: string | Date, timeZone: string): string {
  return formatter(`date|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

export function formatTime(value: string | Date, timeZone: string): string {
  return formatter(`time|${timeZone}`, "en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

/**
 * Pinned to UTC: the input names a day, not a moment, so formatting it in the org
 * zone would shift a midnight anchor onto the neighbouring date.
 */
export function formatDay(day: string): string {
  return formatter("day|UTC", "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function formatBusinessDate(day: string): string {
  return formatter("businessDate|UTC", "en-IN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
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
