export type SessionGate = "loading" | "redirect" | "ready";

export function sessionGate(
  hasObservedSession: boolean,
  isPending: boolean,
  hasSession: boolean,
): SessionGate {
  if (isPending || (!hasSession && !hasObservedSession)) return "loading";
  return hasSession ? "ready" : "redirect";
}
