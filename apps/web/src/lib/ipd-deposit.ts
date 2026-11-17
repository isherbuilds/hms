import { formatMoney } from "./money";

/** How far the running bill is past the deposit held; 0 when the deposit covers it. */
export function depositShortfall(runningBill: bigint, depositHeld: bigint): bigint {
  return runningBill > depositHeld ? runningBill - depositHeld : 0n;
}

/** "Deposit short by ₹2,000.00", or null when the deposit covers the running bill. */
export function depositShortLabel(
  runningBill: bigint,
  depositHeld: bigint,
  currency: string,
): string | null {
  const short = depositShortfall(runningBill, depositHeld);

  return short > 0n ? `Deposit short by ${formatMoney(short, currency)}` : null;
}
