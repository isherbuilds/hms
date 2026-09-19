// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/utils/date-presets.ts: date-fns on the device clock
// becomes YYYY-MM-DD string maths from the organization's business date.
import { formatBusinessDate } from "./business-date";

// UTC throughout: a business date names a day, so a preset never shifts across zones.
function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function monthStart(day: string): string {
  return `${day.slice(0, 8)}01`;
}

export function datePresets(today: string) {
  const yesterday = shift(today, -1);
  const lastMonthEnd = shift(monthStart(today), -1);

  return [
    { id: "today", label: "Today", from: today, to: today },
    { id: "yesterday", label: "Yesterday", from: yesterday, to: yesterday },
    { id: "last-7-days", label: "Last 7 days", from: shift(today, -6), to: today },
    { id: "last-30-days", label: "Last 30 days", from: shift(today, -29), to: today },
    { id: "this-month", label: "This month", from: monthStart(today), to: today },
    { id: "last-month", label: "Last month", from: monthStart(lastMonthEnd), to: lastMonthEnd },
  ];
}

/** `unset` is what no range means to the caller: a report says "All time", a desk "Today". */
export function dateRangeLabel(
  today: string,
  from?: string,
  to?: string,
  unset = "All time",
): string {
  const preset = datePresets(today).find((each) => each.from === from && each.to === to);

  if (preset) return preset.label;

  if (from && to) {
    return from === to
      ? formatBusinessDate(from)
      : `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
  }

  if (from) return `From ${formatBusinessDate(from)}`;

  return to ? `Until ${formatBusinessDate(to)}` : unset;
}
