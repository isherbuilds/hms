/**
 * Route-pending fallback. Deliberately not a spinner: the global
 * reduced-motion rule freezes animations, and a stalled spinner reads as a
 * hang. A static line is honest at any motion setting.
 */
export default function Loader() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-xs text-muted-foreground">
      Loading…
    </div>
  );
}
