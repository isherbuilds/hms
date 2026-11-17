const SEARCH_RADIUS_MS = 36 * 60 * 60 * 1_000;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }

  return formatter;
}

function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateTimeFormatters.set(timeZone, formatter);
  }

  return formatter;
}

function localMinuteKey(instant: number, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function localMinute(instant: Date, timeZone: string): string {
  return localMinuteKey(instant.getTime(), dateTimeFormatter(timeZone));
}

export function businessDate(instant: Date, timeZone: string): string {
  return dateFormatter(timeZone).format(instant);
}

/**
 * The first instant whose local wall time is `value` or later: the wall time itself, or
 * the end of a daylight-saving gap that skips it.
 */
export function localWallTimeAtOrAfter(value: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error(`Invalid local date and time ${value}`);
  }

  const formatter = dateTimeFormatter(timeZone);
  const nominal = Date.parse(`${value}:00Z`);
  let before = nominal - SEARCH_RADIUS_MS;
  let atOrAfter = nominal + SEARCH_RADIUS_MS;

  if (localMinuteKey(before, formatter) >= value || localMinuteKey(atOrAfter, formatter) < value) {
    throw new Error(`Could not find local date and time ${value}`);
  }

  while (atOrAfter - before > 1) {
    const candidate = before + Math.floor((atOrAfter - before) / 2);

    if (localMinuteKey(candidate, formatter) < value) before = candidate;
    else atOrAfter = candidate;
  }

  return new Date(atOrAfter);
}

export function localDateTime(value: string, timeZone: string): Date {
  const instant = localWallTimeAtOrAfter(value, timeZone);

  if (localMinute(instant, timeZone) !== value) {
    throw new Error(`Local date and time ${value} does not exist in ${timeZone}`);
  }

  return instant;
}

/** A calendar date (YYYY-MM-DD) moved by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function businessDateAnchor(instant: Date, timeZone: string): Date {
  return new Date(`${businessDate(instant, timeZone)}T00:00:00Z`);
}
