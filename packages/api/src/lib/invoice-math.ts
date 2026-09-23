import { divideHalfUp, parseDecimal } from "../core/money";

export type InvoiceBalance = {
  grandTotal: bigint;
  creditTotal: bigint;
  paymentsTotal: bigint;
  allocationsTotal: bigint;
  refundsTotal: bigint;
  outstanding: bigint;
};

export function calculateInvoiceBalance({
  grandTotal,
  creditTotal,
  paymentsTotal,
  allocationsTotal,
  refundsTotal,
}: Omit<InvoiceBalance, "outstanding">): InvoiceBalance {
  return {
    grandTotal,
    creditTotal,
    paymentsTotal,
    allocationsTotal,
    refundsTotal,
    outstanding: grandTotal - creditTotal - paymentsTotal - allocationsTotal + refundsTotal,
  };
}

type ChargeInput = {
  chargeId: string;
  description: string;
  qty: number;
  unitPrice: bigint;
  priceUnits: number;
  taxRatePercent: string;
  taxCode: string | null;
};

type InvoiceLine = {
  chargeId: string;
  description: string;
  qty: number;
  unitPrice: bigint;
  priceUnits: number;
  lineSubtotal: bigint;
  allocatedDiscount: bigint;
  taxableValue: bigint;
  taxRatePercent: string;
  taxAmount: bigint;
  gross: bigint;
  taxCode: string | null;
};

export type InvoiceStream = "opd" | "pharmacy";

export class InvoiceDiscountExceededError extends Error {}

function gcd(left: bigint, right: bigint): bigint {
  while (right !== 0n) {
    [left, right] = [right, left % right];
  }

  return left;
}

export function computeInvoiceLines(
  charges: ChargeInput[],
  discountPaise: bigint,
  stream: InvoiceStream,
) {
  // Pharmacy MRP carries its tax and its document total rounds to whole rupees;
  // OPD prices are tax-exclusive and total to the paisa.
  const inclusive = stream === "pharmacy";
  let commonUnits = 1n;

  const preparedLines = charges.map((charge) => {
    if (!Number.isSafeInteger(charge.qty) || charge.qty < 0) {
      throw new Error(`Invalid quantity: ${charge.qty}`);
    }

    if (!Number.isSafeInteger(charge.priceUnits) || charge.priceUnits < 1) {
      throw new Error(`Invalid price units: ${charge.priceUnits}`);
    }

    const units = BigInt(charge.priceUnits);
    commonUnits = (commonUnits / gcd(commonUnits, units)) * units;

    return { charge, units, lineSubtotal: 0n, allocatedDiscount: 0n, remainder: 0n };
  });

  let exactSubtotal = 0n;
  let floorTotal = 0n;

  for (const line of preparedLines) {
    // One common denominator preserves the exact price of every stock unit.
    const numerator = BigInt(line.charge.qty) * line.charge.unitPrice * (commonUnits / line.units);
    line.lineSubtotal = numerator / commonUnits;
    line.remainder = numerator % commonUnits;
    exactSubtotal += numerator;
    floorTotal += line.lineSubtotal;
  }

  const subtotalPaise = divideHalfUp(exactSubtotal, commonUnits);
  const leftover = Number(subtotalPaise - floorTotal);

  // Stable sort gives an input-order tie break for equal fractional paise.
  const ranked = [...preparedLines].sort((a, b) =>
    a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1,
  );

  for (let index = 0; index < leftover; index++) {
    ranked[index]!.lineSubtotal += 1n;
  }

  if (discountPaise > subtotalPaise) {
    throw new InvoiceDiscountExceededError("Discount cannot exceed invoice subtotal");
  }

  for (const line of preparedLines) {
    line.allocatedDiscount =
      subtotalPaise === 0n ? 0n : divideHalfUp(discountPaise * line.lineSubtotal, subtotalPaise);
  }

  let largestLine: (typeof preparedLines)[number] | undefined;

  for (const line of preparedLines) {
    if (largestLine === undefined || line.lineSubtotal > largestLine.lineSubtotal) {
      largestLine = line;
    }
  }

  if (largestLine !== undefined) {
    const allocatedTotal = preparedLines.reduce((sum, line) => sum + line.allocatedDiscount, 0n);
    largestLine.allocatedDiscount += discountPaise - allocatedTotal;
  }

  let taxTotalPaise = 0n;
  let preRoundPaise = 0n;

  const lines = preparedLines.map(({ charge, lineSubtotal, allocatedDiscount }): InvoiceLine => {
    const netPaise = lineSubtotal - allocatedDiscount;
    const rate = parseDecimal(charge.taxRatePercent);

    // Inclusive: the net amount already contains the tax, so it is the gross and the
    // taxable value is extracted from it. Exclusive: the net is taxable.
    const taxableValuePaise = inclusive
      ? divideHalfUp(netPaise * 10_000n, 10_000n + rate)
      : netPaise;

    const taxAmountPaise = inclusive
      ? netPaise - taxableValuePaise
      : divideHalfUp(netPaise * rate, 10_000n);

    const grossPaise = inclusive ? netPaise : netPaise + taxAmountPaise;

    taxTotalPaise += taxAmountPaise;
    preRoundPaise += grossPaise;

    return {
      chargeId: charge.chargeId,
      description: charge.description,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      priceUnits: charge.priceUnits,
      lineSubtotal,
      allocatedDiscount,
      taxableValue: taxableValuePaise,
      taxRatePercent: charge.taxRatePercent,
      taxAmount: taxAmountPaise,
      gross: grossPaise,
      taxCode: charge.taxCode,
    };
  });

  const grandTotal = inclusive ? divideHalfUp(preRoundPaise, 100n) * 100n : preRoundPaise;

  return {
    lines,
    subtotal: subtotalPaise,
    taxTotal: taxTotalPaise,
    roundOff: grandTotal - preRoundPaise,
    grandTotal,
  };
}

export function derivePartialCredit(gross: bigint, taxRatePercent: string) {
  const taxableValue = divideHalfUp(gross * 10_000n, 10_000n + parseDecimal(taxRatePercent));

  return { taxableValue, taxAmount: gross - taxableValue, gross };
}

/** Half-up on CGST, remainder to SGST; sign-preserving so credit notes split the same way. */
export function splitGst(taxAmount: bigint) {
  const cgst = divideHalfUp(taxAmount, 2n);

  return { cgst, sgst: taxAmount - cgst };
}

export function fiscalYearLabel(date: Date, startMonth: number): string {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`Invalid fiscal year start month: ${startMonth}`);
  }

  const year = date.getUTCFullYear();

  if (startMonth === 1) {
    return String(year);
  }

  const currentMonth = date.getUTCMonth() + 1;
  const startYear = currentMonth >= startMonth ? year : year - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function documentNumber(prefix: string, fiscalYear: string, seq: number): string {
  return `${prefix}${fiscalYear}/${seq}`;
}
