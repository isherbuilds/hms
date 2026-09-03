type DatabaseError = {
  cause?: unknown;
  code?: unknown;
  constraint?: unknown;
};

/**
 * Walks an error and its `cause` chain. The driver wraps the Postgres error, so
 * `code` is never on the outermost one. The `seen` set stops a self-referential
 * cause from looping forever.
 */
export function uniqueViolationConstraint(error: unknown): string | null | undefined {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const databaseError = current as DatabaseError;
    if (databaseError.code === "23505") {
      return typeof databaseError.constraint === "string" ? databaseError.constraint : null;
    }
    current = databaseError.cause;
  }

  return undefined;
}
