type DatabaseError = {
  cause?: unknown;
  code?: unknown;
  constraint?: unknown;
};

export function uniqueViolationConstraint(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as DatabaseError;
    if (candidate.code === "23505") {
      return typeof candidate.constraint === "string" ? candidate.constraint : undefined;
    }
    current = candidate.cause;
  }

  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as DatabaseError;
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }

  return false;
}
