import { addDays, businessDate, localWallTimeAtOrAfter } from "./business-date";

export type BedDayStay = {
  startedAt: Date;
  endedAt: Date | null;
  categoryId: string;
  tariffId: string;
};

export type BedDay = { day: number; date: string; categoryId: string; tariffId: string };

/**
 * The instant the hospital's checkout wall time falls on a local calendar date; a
 * checkout inside a daylight-saving gap falls at the end of the gap.
 */
function checkoutOn(date: string, checkoutMinutes: number, timeZone: string): number {
  const hours = String(Math.floor(checkoutMinutes / 60)).padStart(2, "0");
  const minutes = String(checkoutMinutes % 60).padStart(2, "0");

  return localWallTimeAtOrAfter(`${date}T${hours}:${minutes}`, timeZone).getTime();
}

type Held = { ms: number; lastStart: number };

/** Longest held wins; on a tie, the one occupied later. */
function longest<Key>(held: Map<Key, Held>): Key | undefined {
  let winner: [Key, Held] | undefined;

  for (const entry of held) {
    const [, candidate] = entry;

    if (
      !winner ||
      candidate.ms > winner[1].ms ||
      (candidate.ms === winner[1].ms && candidate.lastStart > winner[1].lastStart)
    ) {
      winner = entry;
    }
  }

  return winner?.[0];
}

function hold<Key>(held: Map<Key, Held>, key: Key, ms: number, start: number) {
  const entry = held.get(key);

  if (entry) {
    entry.ms += ms;
    entry.lastStart = start;
  } else {
    held.set(key, { ms, lastStart: start });
  }
}

/** The bed type and tariff a day belongs to, or undefined when no stay reaches into it. */
function dayOwner(stays: BedDayStay[], from: number, to: number) {
  const categories = new Map<string, Held>();
  const tariffs = new Map<string, Map<string, Held>>();

  for (const stay of stays) {
    const start = Math.max(stay.startedAt.getTime(), from);
    const ms = Math.min(stay.endedAt?.getTime() ?? to, to) - start;

    if (ms <= 0) continue;

    hold(categories, stay.categoryId, ms, start);

    const ofCategory = tariffs.get(stay.categoryId) ?? new Map<string, Held>();
    tariffs.set(stay.categoryId, ofCategory);
    hold(ofCategory, stay.tariffId, ms, start);
  }

  const categoryId = longest(categories);

  if (categoryId === undefined) return undefined;

  // SAFETY: a bed type enters `categories` and `tariffs` in the same iteration.
  const tariffId = longest(tariffs.get(categoryId)!)!;

  return { categoryId, tariffId };
}

/**
 * The numbered bed days of a stay through `through` (D066). Day 1 runs from admission to
 * checkout on the next local calendar date; each later day runs checkout to checkout. A
 * day belongs to the bed type occupied longest within it. Pure: nothing is stored.
 */
export function bedDays(
  stays: BedDayStay[],
  admittedAt: Date,
  checkoutMinutes: number,
  timeZone: string,
  through: Date,
): BedDay[] {
  const ordered = stays.toSorted(
    (first, second) => first.startedAt.getTime() - second.startedAt.getTime(),
  );

  const [first] = ordered;

  if (!first) throw new Error("An Admission always has a bed stay");

  const admissionDate = businessDate(admittedAt, timeZone);
  const end = through.getTime();
  const days: BedDay[] = [];
  let from = admittedAt.getTime();

  for (let day = 1; ; day++) {
    const checkout = checkoutOn(addDays(admissionDate, day), checkoutMinutes, timeZone);
    const owner = dayOwner(ordered, from, Math.min(checkout, end));

    // Day 1 is charged even for a stay of no length; a later day only once it is entered.
    if (!owner && day > 1) break;

    days.push({
      day,
      date: addDays(admissionDate, day - 1),
      categoryId: owner?.categoryId ?? first.categoryId,
      tariffId: owner?.tariffId ?? first.tariffId,
    });

    if (end <= checkout) break;

    from = checkout;
  }

  return days;
}
