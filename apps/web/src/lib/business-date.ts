// Dates are assembled from constants, not Intl text: the server's ICU and the browser's
// spell en-IN differently ("at 2:59 AM" against ", 2:59 am"), which breaks hydration.
// The constants match the browser's en-IN medium date, so readers see no change.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];

/** `4 Sept`; `month` is 1-based. */
export function dayMonthLabel(month: number, day: number): string {
  const name = MONTHS[month - 1];

  if (name === undefined || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`Not a calendar day: month ${month}, day ${day}`);
  }

  return `${day} ${name}`;
}

/** `4 Sept 2026`; `month` is 1-based. */
export function dateLabel(year: number, month: number, day: number): string {
  return `${dayMonthLabel(month, day)} ${year}`;
}

/** The parts of a `YYYY-MM-DD` business date. */
export function dayParts(day: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${day}`);

  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  // Day 0 of the next month is the last day of this one, leap years included.
  const monthLength = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();

  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > monthLength) {
    throw new RangeError(`Not a calendar date: ${day}`);
  }

  return parts;
}

/** Format a calendar day without shifting it across time zones. */
export function formatBusinessDate(day: string): string {
  const parts = dayParts(day);

  return dateLabel(parts.year, parts.month, parts.day);
}
