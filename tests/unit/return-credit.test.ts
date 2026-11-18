// Spec: docs/specs/ipd-admission-to-discharge.md, "Returns and corrections" — a return
// after the bill credits the returned quantity's share of the line, the last unit taking
// the exact remainder.
import { expect, test } from "bun:test";
import { divideHalfUp } from "@hms/api/core/money";
import { returnedUnitsCredit, type LineMoney } from "@hms/api/lib/return-credit";

// 100 tablets at ₹2.00 MRP with 5% GST inside the price.
const line = { qty: 100, gross: 200_00n, taxableValue: 190_48n, taxAmount: 9_52n };

/** What `returned` of the line's units are worth: gross and GST shares, rounded half up. */
function shareOf(returned: number): LineMoney {
  const gross = divideHalfUp(line.gross * BigInt(returned), BigInt(line.qty));
  const taxAmount = divideHalfUp(line.taxAmount * BigInt(returned), BigInt(line.qty));

  return { taxableValue: gross - taxAmount, taxAmount, gross };
}

function returnInBatches(batches: number[]) {
  let credited: LineMoney = { taxableValue: 0n, taxAmount: 0n, gross: 0n };
  let returned = 0;

  for (const qty of batches) {
    const credit = returnedUnitsCredit(line, credited, returned, qty);

    credited = {
      taxableValue: credited.taxableValue + credit.taxableValue,
      taxAmount: credited.taxAmount + credit.taxAmount,
      gross: credited.gross + credit.gross,
    };
    returned += qty;

    // Whatever the batches, what has come back is credited at its share, never more.
    expect(credited).toEqual(shareOf(returned));
  }

  return credited;
}

test("one tablet at a time, every return credits only its share and the last takes the remainder", () => {
  const credited = returnInBatches(Array.from({ length: 100 }, () => 1));

  expect(credited).toEqual({
    taxableValue: line.taxableValue,
    taxAmount: line.taxAmount,
    gross: line.gross,
  });
});

test("returns of uneven sizes credit what has come back so far, never units still kept", () => {
  returnInBatches([3, 7, 1, 1, 13, 29, 2, 40]);
});

test("a cheap taxed line returned one unit at a time never credits negative GST or value", () => {
  // Five tablets for ₹0.69 with ₹0.03 GST inside: rounding the value share alone made the
  // third return credit −₹0.01 GST, which the ledger refuses.
  const cheap = { qty: 5, gross: 69n, taxableValue: 66n, taxAmount: 3n };
  let credited: LineMoney = { taxableValue: 0n, taxAmount: 0n, gross: 0n };

  for (let returned = 0; returned < cheap.qty; returned += 1) {
    const credit = returnedUnitsCredit(cheap, credited, returned, 1);

    expect(credit.taxAmount).toBeGreaterThanOrEqual(0n);
    expect(credit.taxableValue).toBeGreaterThanOrEqual(0n);
    credited = {
      taxableValue: credited.taxableValue + credit.taxableValue,
      taxAmount: credited.taxAmount + credit.taxAmount,
      gross: credited.gross + credit.gross,
    };
  }

  expect(credited).toEqual({ taxableValue: 66n, taxAmount: 3n, gross: 69n });
});
