import { expect, test } from "bun:test";

import {
  formatBusinessDate,
  formatDate,
  formatDateTime,
  formatDay,
  formatTime,
} from "../../apps/web/src/lib/org-datetime";

// Expected text is the browser's en-IN output (full ICU), which the server must match
// whatever ICU data its runtime carries, or hydration fails.
const instants: Array<
  [instant: string, timeZone: string, dateTime: string, date: string, time: string]
> = [
  ["2026-11-12T21:29:00Z", "Asia/Kolkata", "13 Nov 2026, 2:59 am", "13 Nov 2026", "2:59 am"],
  ["2026-11-12T18:30:00Z", "Asia/Kolkata", "13 Nov 2026, 12:00 am", "13 Nov 2026", "12:00 am"],
  ["2026-11-13T06:30:00Z", "Asia/Kolkata", "13 Nov 2026, 12:00 pm", "13 Nov 2026", "12:00 pm"],
  ["2026-09-03T18:29:00Z", "Asia/Kolkata", "3 Sept 2026, 11:59 pm", "3 Sept 2026", "11:59 pm"],
  ["2026-12-31T18:30:00Z", "Asia/Kolkata", "1 Jan 2027, 12:00 am", "1 Jan 2027", "12:00 am"],
  ["2026-12-31T23:59:00Z", "UTC", "31 Dec 2026, 11:59 pm", "31 Dec 2026", "11:59 pm"],
  ["2027-01-01T00:00:00Z", "UTC", "1 Jan 2027, 12:00 am", "1 Jan 2027", "12:00 am"],
  ["2026-06-05T12:00:00Z", "UTC", "5 Jun 2026, 12:00 pm", "5 Jun 2026", "12:00 pm"],
  ["2027-01-01T04:59:00Z", "America/New_York", "31 Dec 2026, 11:59 pm", "31 Dec 2026", "11:59 pm"],
  ["2026-03-08T07:05:00Z", "America/New_York", "8 Mar 2026, 3:05 am", "8 Mar 2026", "3:05 am"],
  ["2026-07-04T16:00:00Z", "America/Los_Angeles", "4 Jul 2026, 9:00 am", "4 Jul 2026", "9:00 am"],
  ["2026-05-09T23:45:00Z", "Asia/Kathmandu", "10 May 2026, 5:30 am", "10 May 2026", "5:30 am"],
];

test.each(instants)(
  "%s in %s reads as the browser's en-IN",
  (instant, timeZone, dateTime, date, time) => {
    expect(formatDateTime(instant, timeZone)).toBe(dateTime);
    expect(formatDateTime(new Date(instant), timeZone)).toBe(dateTime);
    expect(formatDate(instant, timeZone)).toBe(date);
    expect(formatTime(instant, timeZone)).toBe(time);
  },
);

const days: Array<[day: string, date: string, dayMonth: string]> = [
  ["2026-01-01", "1 Jan 2026", "1 Jan"],
  ["2026-09-03", "3 Sept 2026", "3 Sept"],
  ["2026-12-31", "31 Dec 2026", "31 Dec"],
  ["2027-02-28", "28 Feb 2027", "28 Feb"],
];

test.each(days)("business date %s reads as written", (day, date, dayMonth) => {
  expect(formatBusinessDate(day)).toBe(date);
  expect(formatDay(day)).toBe(dayMonth);
});

test("every month has the browser's en-IN short name", () => {
  expect(
    Array.from(
      { length: 12 },
      (_, index) =>
        formatBusinessDate(`2026-${String(index + 1).padStart(2, "0")}-15`).split(" ")[1],
    ),
  ).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]);
});

test("a value that is not a date fails loud", () => {
  expect(() => formatBusinessDate("2026-13-01")).toThrow(RangeError);
  expect(() => formatBusinessDate("13 Nov 2026")).toThrow(RangeError);
  expect(() => formatDateTime("not a date", "UTC")).toThrow(RangeError);
});

test("a business date that is not on the calendar fails loud", () => {
  for (const day of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-04-00", "2026-04-31"]) {
    expect(() => formatBusinessDate(day)).toThrow(RangeError);
  }
});

test("29 Feb is a business date in a leap year", () => {
  expect(formatBusinessDate("2028-02-29")).toBe("29 Feb 2028");
});
