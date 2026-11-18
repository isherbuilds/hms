import { ORPCError } from "@orpc/server";

/**
 * Walks an error and its `cause` chain. The driver wraps the Postgres error, so
 * `code` is never on the outermost one. The `seen` set stops a self-referential
 * cause from looping forever.
 */
function violationConstraint(error: unknown, code: string): string | null | undefined {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if ("code" in current && current.code === code) {
      const constraint = "constraint" in current ? current.constraint : undefined;

      return typeof constraint === "string" ? constraint : null;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

export function uniqueViolationConstraint(error: unknown): string | null | undefined {
  return violationConstraint(error, "23505");
}

export function exclusionViolationConstraint(error: unknown): string | null | undefined {
  return violationConstraint(error, "23P01");
}

/** A unique-name collision as a CONFLICT naming `what`; any other error rethrows. */
export function nameConflict(error: unknown, what: string): never {
  if (uniqueViolationConstraint(error) !== undefined) {
    throw new ORPCError("CONFLICT", { message: `${what} already exists.` });
  }

  throw error;
}
