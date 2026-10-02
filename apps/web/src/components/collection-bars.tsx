// Daily collection as plain bars: today lime, the rest a soft grey. The line
// above totals the range at rest and reads the hovered or focused day otherwise, with its
// change on the same weekday a week before and its cash and digital split.
import { useState, type ReactNode } from "react";

import { ZERO } from "@/lib/money";
import { formatDay } from "@/lib/org-datetime";

export type CollectionDay = { day: string; amount: bigint; cash: bigint; digital: bigint };

const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });

export function CollectionBars({
  trend,
  range,
  today,
  showTotal,
  money,
  action,
}: {
  /** Oldest first and gap-filled, ending today, with a week of history before `range`. */
  trend: readonly CollectionDay[];
  range: number;
  /** The org's business date; the last bar is the range's end, which may be earlier. */
  today: string;
  /** Off when the card's headline already states the same total. */
  showTotal: boolean;
  money: (value: bigint) => string;
  /** The range switch, on the readout's line. */
  action: ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const start = Math.max(trend.length - range, 0);
  const days = trend.slice(start);
  const index = hovered !== null && hovered < days.length ? hovered : days.length - 1;
  const shown = days[index];
  // At rest the line totals the range: the card's headline already states the last day.
  const total = days.reduce((sum, day) => sum + day.amount, ZERO);
  const weekBefore = trend[start + index - 7];
  // The bar geometry needs numbers; money stays bigint everywhere else.
  const max = Math.max(...days.map((day) => Number(day.amount)), 0);
  const min = Math.min(...days.map((day) => Number(day.amount)), 0);
  const span = Math.max(max - min, 1);
  const baseline = (-min / span) * 100;

  if (!shown) return <div className="flex min-h-48 justify-end">{action}</div>;

  const isToday = shown.day === today;

  // Today is part-way through and the headline already compares it.
  const change =
    !isToday && shown.amount > ZERO && weekBefore && weekBefore.amount > ZERO
      ? Math.round((Number(shown.amount) / Number(weekBefore.amount) - 1) * 100)
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-4">
      {/* Two fixed lines, so hovering never reflows the switch or the bars. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-medium tabular-nums">
            {hovered === null
              ? `${days.length} days${showTotal ? ` · ${money(total)}` : ""}`
              : `${isToday ? "Today" : formatDay(shown.day)} · ${money(shown.amount)}`}
          </p>
          <div className="shrink-0">{action}</div>
        </div>
        <p className="min-h-4 truncate text-muted-foreground tabular-nums">
          {hovered === null
            ? "Point at a bar to see its day"
            : [
                change !== null &&
                  `${change >= 0 ? "+" : ""}${change}% on last ${weekday.format(new Date(`${shown.day}T00:00:00Z`))}`,
                `Digital ${money(shown.digital)} · Cash ${money(shown.cash)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>

      <div
        role="group"
        aria-label="Collection by day"
        className={`grid h-32 items-end ${range > 14 ? "gap-1" : "gap-2"}`}
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHovered(null)}
      >
        {days.map((day, position) => {
          const tone =
            position === days.length - 1
              ? "bg-brand-fill"
              : hovered === position
                ? "bg-foreground/35"
                : "bg-foreground/12";

          return (
            <button
              key={day.day}
              type="button"
              data-focus-inset
              aria-label={`${formatDay(day.day)}: ${money(day.amount)}`}
              onMouseEnter={() => setHovered(position)}
              onFocus={() => setHovered(position)}
              onBlur={() => setHovered(null)}
              className="relative h-full"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 border-t border-border"
                style={{ bottom: `${baseline}%` }}
              />
              <span
                className={`absolute inset-x-0 rounded-sm ${day.amount !== ZERO ? tone : "bg-foreground/8"}`}
                style={{
                  height:
                    day.amount !== ZERO ? `${(Math.abs(Number(day.amount)) / span) * 100}%` : 3,
                  bottom: `${day.amount < ZERO ? baseline - (Math.abs(Number(day.amount)) / span) * 100 : baseline}%`,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{days[0] && formatDay(days[0].day)}</span>
        <span>{days.at(-1)?.day === today ? "Today" : formatDay(days.at(-1)?.day ?? today)}</span>
      </div>
    </div>
  );
}
