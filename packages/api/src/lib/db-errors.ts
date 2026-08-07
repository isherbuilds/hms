export function isUniqueViolation(error: unknown): boolean {
  let current = error;

  while (current && typeof current === "object") {
    const candidate = current as { cause?: unknown; code?: unknown };
    if (candidate.code === "23505") {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}
