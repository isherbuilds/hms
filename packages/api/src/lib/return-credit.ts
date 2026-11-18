import { divideHalfUp } from "../core/money";

export type LineMoney = { taxableValue: bigint; taxAmount: bigint; gross: bigint };

/** Credit Note lines summed per Invoice line. */
export function creditsByLine(rows: ReadonlyArray<LineMoney & { invoiceLineId: string }>) {
  const creditedByLine = new Map<string, LineMoney>();

  for (const row of rows) {
    const credited = creditedByLine.get(row.invoiceLineId) ?? {
      taxableValue: 0n,
      taxAmount: 0n,
      gross: 0n,
    };

    credited.taxableValue += row.taxableValue;
    credited.taxAmount += row.taxAmount;
    credited.gross += row.gross;
    creditedByLine.set(row.invoiceLineId, credited);
  }

  return creditedByLine;
}

/**
 * The credit for `qty` units coming back on an invoice line, `returnedBefore` of which
 * came back earlier and `prior` of which earlier Credit Notes took off. The share is
 * cumulative: what `returnedBefore + qty` units are worth less what `returnedBefore` were,
 * so many small returns never round ahead of the units back. Gross and GST are each
 * rounded half up and the value is their difference, so no return credits negative GST.
 * The last unit takes the exact remainder, so a full return reverses the line to the paisa.
 * After a bare price correction the share is held to what is left: gross to the gross
 * left, GST to the GST left, and value to the value left.
 */
export function returnedUnitsCredit(
  source: LineMoney & { qty: number },
  prior: LineMoney | undefined,
  returnedBefore: number,
  qty: number,
): LineMoney {
  const left = {
    taxableValue: source.taxableValue - (prior?.taxableValue ?? 0n),
    taxAmount: source.taxAmount - (prior?.taxAmount ?? 0n),
    gross: source.gross - (prior?.gross ?? 0n),
  };

  if (returnedBefore + qty === source.qty) return left;

  const before = BigInt(returnedBefore);
  const after = BigInt(returnedBefore + qty);
  const sold = BigInt(source.qty);

  const share = (amount: bigint) =>
    divideHalfUp(amount * after, sold) - divideHalfUp(amount * before, sold);

  const gross = min(share(source.gross), left.gross);
  const taxAmount = max(gross - left.taxableValue, min(share(source.taxAmount), left.taxAmount));

  return { taxableValue: gross - taxAmount, taxAmount, gross };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

const max = (a: bigint, b: bigint) => (a > b ? a : b);
