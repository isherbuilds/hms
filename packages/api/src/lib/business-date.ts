const SEARCH_RADIUS_MS = 36 * 60 * 60 * 1_000;

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Binary search, not offset arithmetic: in a zone that skips midnight for
// daylight saving the day starts at 01:00, and no offset formula finds that.
function localDateBoundary(date: string, formatter: Intl.DateTimeFormat): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const nominal = Date.UTC(year, month - 1, day);
  let before = nominal - SEARCH_RADIUS_MS;
  let atOrAfter = nominal + SEARCH_RADIUS_MS;

  if (formatter.format(before) >= date || formatter.format(atOrAfter) < date) {
    throw new Error(`Could not find the start of Business Date ${date}`);
  }

  while (atOrAfter - before > 1) {
    const candidate = before + Math.floor((atOrAfter - before) / 2);
    if (formatter.format(candidate) < date) {
      before = candidate;
    } else {
      atOrAfter = candidate;
    }
  }

  if (formatter.format(atOrAfter) !== date) {
    throw new Error(`Business Date ${date} does not exist in this time zone`);
  }
  return new Date(atOrAfter);
}

export function businessDate(instant: Date, timeZone: string): string {
  return dateFormatter(timeZone).format(instant);
}

export function businessDayWindow(date: string, timeZone: string): { start: Date; end: Date } {
  const formatter = dateFormatter(timeZone);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);

  return {
    start: localDateBoundary(date, formatter),
    end: localDateBoundary(nextDate, formatter),
  };
}

export function businessDateAnchor(instant: Date, timeZone: string): Date {
  return new Date(`${businessDate(instant, timeZone)}T00:00:00Z`);
}
