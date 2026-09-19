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
  taxRatePercent: string;
  taxCode: string | null;
};

type InvoiceLine = {
  chargeId: string;
  description: string;
  qty: number;
  unitPrice: bigint;
  lineSubtotal: bigint;
  allocatedDiscount: bigint;
  taxableValue: bigint;
  taxRatePercent: string;
  taxAmount: bigint;
  gross: bigint;
  taxCode: string | null;
};

export type PriceBasis = "exclusive" | "inclusive";

export function priceBasisFor(stream: "opd" | "pharmacy"): PriceBasis {
  return stream === "pharmacy" ? "inclusive" : "exclusive";
}

export function computeInvoiceLines(
  charges: ChargeInput[],
  discountPaise: bigint,
  basis: PriceBasis,
) {
  const preparedLines = charges.map((charge) => {
    if (!Number.isSafeInteger(charge.qty) || charge.qty < 0) {
      throw new Error(`Invalid quantity: ${charge.qty}`);
    }

    return { charge, lineSubtotal: charge.unitPrice * BigInt(charge.qty), allocatedDiscount: 0n };
  });

  const subtotalPaise = preparedLines.reduce((sum, line) => sum + line.lineSubtotal, 0n);

  if (discountPaise > subtotalPaise) {
    throw new Error("Discount cannot exceed invoice subtotal");
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
  let grandTotalPaise = 0n;

  const lines = preparedLines.map(({ charge, lineSubtotal, allocatedDiscount }): InvoiceLine => {
    const netPaise = lineSubtotal - allocatedDiscount;
    const rate = parseDecimal(charge.taxRatePercent);

    // Inclusive (pharmacy MRP): the net amount already contains the tax, so it is the
    // gross and the taxable value is extracted from it. Exclusive: the net is taxable.
    const taxableValuePaise =
      basis === "inclusive" ? divideHalfUp(netPaise * 10_000n, 10_000n + rate) : netPaise;

    const taxAmountPaise =
      basis === "inclusive" ? netPaise - taxableValuePaise : divideHalfUp(netPaise * rate, 10_000n);

    const grossPaise = basis === "inclusive" ? netPaise : netPaise + taxAmountPaise;

    taxTotalPaise += taxAmountPaise;
    grandTotalPaise += grossPaise;

    return {
      chargeId: charge.chargeId,
      description: charge.description,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      lineSubtotal,
      allocatedDiscount,
      taxableValue: taxableValuePaise,
      taxRatePercent: charge.taxRatePercent,
      taxAmount: taxAmountPaise,
      gross: grossPaise,
      taxCode: charge.taxCode,
    };
  });

  return {
    lines,
    subtotal: subtotalPaise,
    taxTotal: taxTotalPaise,
    grandTotal: grandTotalPaise,
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
