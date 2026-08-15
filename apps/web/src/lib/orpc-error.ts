export function isConflictError(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "CONFLICT") return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}
