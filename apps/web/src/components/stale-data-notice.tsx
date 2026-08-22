import { useEffect, useState } from "react";

/**
 * Polling screens look identical whether their 10s refetch is succeeding or
 * silently failing, and a front desk acting on a dead queue is worse than one
 * that knows the connection dropped. This surfaces only the failure case: it
 * renders nothing while data is fresher than three poll intervals, then names
 * the age of what is on screen. Mounted-only ticking keeps it out of SSR HTML,
 * so it can never cause a hydration mismatch.
 */
export function StaleDataNotice({
  dataUpdatedAt,
  intervalMs = 10_000,
}: {
  /** Oldest `dataUpdatedAt` among the queries that feed the screen. */
  dataUpdatedAt: number;
  intervalMs?: number;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(tick);
  }, []);

  if (now === null || dataUpdatedAt === 0) return null;
  const ageMs = now - dataUpdatedAt;
  if (ageMs < intervalMs * 3) return null;

  const minutes = Math.floor(ageMs / 60_000);
  const age = minutes >= 1 ? `${minutes} min` : `${Math.floor(ageMs / 1000)} s`;

  return (
    <p role="status" className="shrink-0 text-xs font-medium text-destructive">
      Not updating — data is {age} old
    </p>
  );
}
