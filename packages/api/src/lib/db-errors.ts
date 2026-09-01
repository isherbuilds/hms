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
function* causes(error: unknown): Generator<DatabaseError> {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    yield current as DatabaseError;
    current = (current as DatabaseError).cause;
  }
}

/** `23505` is Postgres for "unique violation". */
function uniqueViolation(error: unknown): DatabaseError | undefined {
  for (const link of causes(error)) {
    if (link.code === "23505") return link;
  }

  return undefined;
}

export function uniqueViolationConstraint(error: unknown): string | undefined {
  const constraint = uniqueViolation(error)?.constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return uniqueViolation(error) !== undefined;
}
