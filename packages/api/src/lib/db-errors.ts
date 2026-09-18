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

    if ("code" in current && current.code === "23505") {
      const constraint = "constraint" in current ? current.constraint : undefined;

      return typeof constraint === "string" ? constraint : null;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}
