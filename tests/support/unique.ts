let sequence = 0;

// Deliberately not a sliced UUID: truncating a v7 is silently broken, since its
// leading bytes are the timestamp. Reach for nanoid instead.
export function uniqueSuffix(): string {
  sequence += 1;

  return sequence.toString(36);
}

export function sumMoney(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}
