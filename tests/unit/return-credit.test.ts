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

test("after a price correction a return credits no more than its share, and no more GST than is left", () => {
  // Two tablets for ₹9.12 with 5% GST inside; a ₹4.52 correction leaves ₹4.60, ₹0.21 of it GST.
  // One tablet's share is ₹4.56 with ₹0.22 GST: the GST is held to what is left, and the
  // kept tablet keeps the rest instead of the return taking the whole line.
  const pair = { qty: 2, gross: 9_12n, taxableValue: 8_69n, taxAmount: 43n };
  const correction: LineMoney = { taxableValue: 4_30n, taxAmount: 22n, gross: 4_52n };

  expect(returnedUnitsCredit(pair, correction, 0, 1)).toEqual({
    taxableValue: 4_35n,
    taxAmount: 21n,
    gross: 4_56n,
  });
});

test("a return worth no money on a line of a few paise credits no value either", () => {
  // Five units for 4 paise with 1 paisa GST, two back for 2 paise: the third unit's gross
  // share rounds to nothing while its GST share rounds up to a paisa.
  const tiny = { qty: 5, gross: 4n, taxableValue: 3n, taxAmount: 1n };
  const credited: LineMoney = { taxableValue: 2n, taxAmount: 0n, gross: 2n };

  expect(returnedUnitsCredit(tiny, credited, 2, 1)).toEqual({
    taxableValue: 0n,
    taxAmount: 0n,
    gross: 0n,
  });
});
