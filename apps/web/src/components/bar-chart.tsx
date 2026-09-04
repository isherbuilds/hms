import { useState } from "react";

// Dependency-free SVG: one series, one ink, no axes library. Mark spec in docs/design.md.
export type BarDatum = { label: string; value: number; caption: string };

export function BarChart({
  data,
  formatValue,
  height = 96,
}: {
  data: readonly BarDatum[];
  formatValue: (value: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...data.map((d) => d.value), 0);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);

  // An empty period still draws its axis and slots, so the panel keeps its shape.
  if (data.length === 0 || max === 0) {
    return (
      <div className="flex flex-1 flex-col justify-end gap-2">
        <p className="m-auto text-muted-foreground">Nothing collected in this period yet.</p>
        <div className="flex items-end gap-0.5 border-b border-border" style={{ height: 24 }}>
          {(data.length > 0 ? data : Array.from({ length: 14 })).map((_, index) => (
            <span key={index} className="h-0.5 flex-1 rounded-t-sm bg-foreground/10" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The hover readout sits above the plot in a fixed-height row, so
          revealing it never reflows the chart below it. */}
      <div className="flex h-8 items-baseline gap-2">
        <span className="text-lg font-medium tabular-nums">
          {formatValue(data[active ?? peak]?.value ?? 0)}
        </span>
        <span className="text-muted-foreground">{data[active ?? peak]?.caption}</span>
      </div>

      <div
        className="flex items-end gap-0.5 border-b border-border"
        style={{ height }}
        // `group`, not `img`: an img role hides the focusable day buttons from AT.
        role="group"
        aria-label={`Daily collections. Highest ${formatValue(data[peak]?.value ?? 0)} on ${data[peak]?.caption}.`}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((datum, index) => (
          <button
            key={datum.label}
            type="button"
            // The hit target is the full column, not the drawn bar: a 2px bar would be unhoverable.
            className="group flex h-full flex-1 items-end"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            aria-label={`${datum.caption}: ${formatValue(datum.value)}`}
          >
            {/* A day with no payments still gets a 2px stub, so fourteen days
                read as fourteen slots rather than as one bar floating in
                whitespace. */}
            <span
              className={
                datum.value === 0
                  ? "h-0.5 w-full rounded-t-sm bg-foreground/10"
                  : index === (active ?? peak)
                    ? "w-full rounded-t-sm bg-foreground"
                    : "w-full rounded-t-sm bg-foreground/25 group-hover:bg-foreground/40"
              }
              style={
                datum.value === 0
                  ? undefined
                  : { height: `${Math.max((datum.value / max) * 100, 2)}%` }
              }
            />
          </button>
        ))}
      </div>

      <div className="flex justify-between text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
