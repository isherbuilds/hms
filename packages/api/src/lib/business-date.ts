const SEARCH_RADIUS_MS = 36 * 60 * 60 * 1_000;

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
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

export function localDateTime(value: string, timeZone: string): Date {
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

  if (localMinuteKey(atOrAfter, formatter) !== value) {
    throw new Error(`Local date and time ${value} does not exist in ${timeZone}`);
  }

  return new Date(atOrAfter);
}

export function businessDateAnchor(instant: Date, timeZone: string): Date {
  return new Date(`${businessDate(instant, timeZone)}T00:00:00Z`);
}
