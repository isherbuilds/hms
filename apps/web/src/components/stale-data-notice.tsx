import { useEffect, useState } from "react";

// Renders nothing until data is older than three 10 s poll intervals, then names
// its age. Mounted-only ticking keeps it out of SSR HTML, so it cannot cause a
// hydration mismatch.
const STALE_AFTER_MS = 30_000;

export function StaleDataNotice({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(tick);
  }, []);

  if (now === null || dataUpdatedAt === 0) return null;
  const ageMs = now - dataUpdatedAt;
  if (ageMs < STALE_AFTER_MS) return null;

  const minutes = Math.floor(ageMs / 60_000);
  const age = minutes >= 1 ? `${minutes} min` : `${Math.floor(ageMs / 1000)} s`;

  return (
    <p role="status" className="shrink-0 text-xs font-medium text-destructive">
      Not updating — data is {age} old
    </p>
  );
}
