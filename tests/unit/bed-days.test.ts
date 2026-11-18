// Spec: docs/specs/ipd-admission-to-discharge.md, "Bed charges" and "One rule per
// question": a bed day ends at checkout on the next local calendar date, later days run
// checkout to checkout, and a moved day belongs to the bed type occupied longest.
import { expect, test } from "bun:test";

import { bedDays, type BedDayStay } from "@hms/api/lib/bed-days";

const IST = "Asia/Kolkata";

const NOON = 12 * 60;

// 16 November 2026 is a Monday.
const MON = "2026-11-16";

const TUE = "2026-11-17";

const WED = "2026-11-18";

const THU = "2026-11-19";

const FRI = "2026-11-20";

function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

function segment(
  from: Date,
  to: Date | null,
  categoryId = "general",
  tariffId = `${categoryId}-t1`,
): BedDayStay {
  return { startedAt: from, endedAt: to, categoryId, tariffId };
}

/** One bed for the whole stay, closed at `left`. */
function simple(admitted: Date, left: Date) {
  return bedDays([segment(admitted, left)], admitted, NOON, IST, left);
}

test("admitted Monday 11:00 or 15:00 and left Tuesday 12:00 is one day", () => {
  for (const time of ["11:00", "15:00"]) {
    expect(simple(at(MON, time), at(TUE, "12:00"))).toEqual([
      { day: 1, date: MON, categoryId: "general", tariffId: "general-t1" },
    ]);
  }
});

test("leaving Tuesday 12:01 is two days", () => {
  expect(simple(at(MON, "15:00"), at(TUE, "12:01"))).toEqual([
    { day: 1, date: MON, categoryId: "general", tariffId: "general-t1" },
    { day: 2, date: TUE, categoryId: "general", tariffId: "general-t1" },
  ]);
});

test("admitted and left the same afternoon is one day, and so is a stay of no length", () => {
  expect(simple(at(MON, "14:00"), at(MON, "18:00"))).toHaveLength(1);
  expect(simple(at(MON, "14:00"), at(MON, "14:00"))).toEqual([
    { day: 1, date: MON, categoryId: "general", tariffId: "general-t1" },
  ]);
});

test("day 1 ends at checkout on the next calendar date, however early the Patient arrived", () => {
  // Half past midnight on Monday: the first day still runs to Tuesday noon.
  expect(simple(at(MON, "00:30"), at(TUE, "11:59"))).toHaveLength(1);
  expect(simple(at(MON, "00:30"), at(TUE, "12:01"))).toHaveLength(2);

  // Half an hour earlier it is still Sunday, so the first day ends Monday noon.
  const sunday = "2026-11-15";
  const days = simple(at(sunday, "23:30"), at(MON, "12:01"));

  expect(days.map((day) => day.date)).toEqual([sunday, MON]);
});

test("later days run checkout to checkout, and leaving exactly at a checkout adds none", () => {
  const exact = simple(at(MON, "15:00"), at(THU, "12:00"));

  expect(exact.map((day) => [day.day, day.date])).toEqual([
    [1, MON],
    [2, TUE],
    [3, WED],
  ]);

  expect(simple(at(MON, "15:00"), at(THU, "12:01")).map((day) => day.date)).toEqual([
    MON,
    TUE,
    WED,
    THU,
  ]);
});

test("an open stay is counted through the given instant", () => {
  const admitted = at(MON, "15:00");
  const open = [segment(admitted, null)];

  expect(bedDays(open, admitted, NOON, IST, admitted)).toHaveLength(1);
  expect(bedDays(open, admitted, NOON, IST, at(TUE, "12:00"))).toHaveLength(1);
  expect(bedDays(open, admitted, NOON, IST, at(WED, "09:00"))).toHaveLength(2);
  expect(bedDays(open, admitted, NOON, IST, at(FRI, "12:01"))).toHaveLength(5);
});

test("a closed stay is counted only up to the given instant", () => {
  const admitted = at(MON, "15:00");
  const closed = [segment(admitted, at(FRI, "10:00"))];

  expect(bedDays(closed, admitted, NOON, IST, at(TUE, "13:00"))).toHaveLength(2);
  expect(bedDays(closed, admitted, NOON, IST, at(FRI, "10:00"))).toHaveLength(4);
});

test("the checkout hour moves the boundary", () => {
  const admitted = at(MON, "11:00");
  const tenAm = 10 * 60;

  const days = (left: Date) => bedDays([segment(admitted, left)], admitted, tenAm, IST, left);

  expect(days(at(TUE, "10:00"))).toHaveLength(1);
  expect(days(at(TUE, "10:01"))).toHaveLength(2);
});

test("a day spent five hours in the ward and sixteen in ICU is an ICU day", () => {
  const admitted = at(MON, "15:00");
  const moved = at(MON, "20:00");
  const left = at(TUE, "12:00");

  const days = bedDays(
    [segment(admitted, moved, "general"), segment(moved, left, "icu")],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(days).toEqual([{ day: 1, date: MON, categoryId: "icu", tariffId: "icu-t1" }]);
});

test("a day with several moves goes to the bed type with the most hours in total", () => {
  const admitted = at(MON, "15:00");
  const toIcu = at(TUE, "20:00");
  const back = at(WED, "05:00");
  const left = at(WED, "12:00");

  // Tuesday noon to Wednesday noon: ward 8h, ICU 9h, ward 7h.
  const days = bedDays(
    [
      segment(admitted, toIcu, "general"),
      segment(toIcu, back, "icu"),
      segment(back, left, "general"),
    ],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(days.map((day) => day.categoryId)).toEqual(["general", "general"]);
});

test("on a tie the day goes to the later bed type", () => {
  const admitted = at(MON, "15:00");
  const midnight = at(WED, "00:00");
  const left = at(WED, "12:00");

  const wardFirst = bedDays(
    [segment(admitted, midnight, "general"), segment(midnight, left, "icu")],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(wardFirst.map((day) => day.categoryId)).toEqual(["general", "icu"]);

  const icuFirst = bedDays(
    [segment(admitted, midnight, "icu"), segment(midnight, left, "general")],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(icuFirst.map((day) => day.categoryId)).toEqual(["icu", "general"]);
});

test("only the hours inside the day count toward it", () => {
  const admitted = at(MON, "15:00");
  const moved = at(TUE, "14:00");
  const left = at(WED, "12:00");

  // A long first day in ICU does not carry into the second, spent 22h in the ward.
  const days = bedDays(
    [segment(admitted, moved, "icu"), segment(moved, left, "general")],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(days.map((day) => day.categoryId)).toEqual(["icu", "general"]);
});

test("a day in progress is judged on the hours so far", () => {
  const admitted = at(MON, "15:00");
  const toIcu = at(TUE, "12:00");
  const back = at(TUE, "13:00");

  const stays = [
    segment(admitted, toIcu, "general"),
    segment(toIcu, back, "icu"),
    segment(back, null, "general"),
  ];

  // Half an hour back in the ward: ICU still has the most of the second day.
  expect(bedDays(stays, admitted, NOON, IST, at(TUE, "13:30")).at(-1)!.categoryId).toBe("icu");
  expect(bedDays(stays, admitted, NOON, IST, at(TUE, "15:00")).at(-1)!.categoryId).toBe("general");
});

test("a tariff change mid-stay prices each day at the tariff of the segment it was spent in", () => {
  const admitted = at(MON, "10:00");
  const moved = at(WED, "10:00");

  const stays = [
    segment(admitted, moved, "general", "general-t1"),
    segment(moved, null, "general", "general-t2"),
  ];

  const days = bedDays(stays, admitted, NOON, IST, at(FRI, "09:00"));

  expect(days.map((day) => day.categoryId)).toEqual(["general", "general", "general", "general"]);
  // Wednesday's day began Tuesday noon: 22h on the old tariff, 2h on the new.
  expect(days.map((day) => day.tariffId)).toEqual([
    "general-t1",
    "general-t1",
    "general-t2",
    "general-t2",
  ]);
});

test("a day split evenly between two tariffs of one bed type takes the later", () => {
  const admitted = at(MON, "15:00");
  const moved = at(WED, "00:00");
  const left = at(WED, "12:00");

  const days = bedDays(
    [
      segment(admitted, moved, "general", "general-t1"),
      segment(moved, left, "general", "general-t2"),
    ],
    admitted,
    NOON,
    IST,
    left,
  );

  expect(days.map((day) => day.tariffId)).toEqual(["general-t1", "general-t2"]);
});

test("days follow the Admission's own time zone and its daylight-saving changes", () => {
  const newYork = "America/New_York";
  const elevenAm = 11 * 60;

  // 7 March 2026, 20:00 in New York (EST). Clocks go forward that night, so checkout
  // at 11:00 on 8 March is 15:00 UTC, an hour earlier than the day before.
  const admitted = new Date("2026-03-08T01:00:00Z");
  const checkout = new Date("2026-03-08T15:00:00Z");

  const days = (left: Date) =>
    bedDays([segment(admitted, left)], admitted, elevenAm, newYork, left);

  expect(days(checkout)).toEqual([
    { day: 1, date: "2026-03-07", categoryId: "general", tariffId: "general-t1" },
  ]);
  expect(days(new Date(checkout.getTime() + 60_000)).map((day) => day.date)).toEqual([
    "2026-03-07",
    "2026-03-08",
  ]);
});

test("the day's date is the local one, not the UTC one", () => {
  // 01:00 on Monday in India is still Sunday evening in UTC.
  const admitted = at(MON, "01:00");

  expect(simple(admitted, at(MON, "09:00"))[0]!.date).toBe(MON);
});
