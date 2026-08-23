let sequence = 0;

/**
 * A short, unique-per-process suffix for fixture names — catalog codes, org
 * slugs, email addresses. Each test file resets the database in `beforeAll`,
 * so a counter is all the uniqueness a run needs.
 *
 * Deliberately not a sliced UUID. Truncating a v4 wastes entropy on a value
 * that only has to be distinct inside one process; truncating a v7 is silently
 * broken, because its leading bytes are the timestamp. If short random ids are
 * ever genuinely needed, reach for nanoid rather than cutting a UUID down.
 */
export function uniqueSuffix(): string {
  sequence += 1;
  return sequence.toString(36);
}
