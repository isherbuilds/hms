import { divideHalfUp, parseDecimal } from "../core/money";

export type InvoiceBalance = {
  grandTotal: bigint;
  creditTotal: bigint;
  paymentsTotal: bigint;
  refundsTotal: bigint;
  outstanding: bigint;
};

export function calculateInvoiceBalance({
  grandTotal,
  creditTotal,
  paymentsTotal,
  refundsTotal,
}: Omit<InvoiceBalance, "outstanding">): InvoiceBalance {
  return {
    grandTotal,
    creditTotal,
    paymentsTotal,
    refundsTotal,
    outstanding: grandTotal - creditTotal - paymentsTotal + refundsTotal,
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

export function computeInvoiceLines(charges: ChargeInput[], discountPaise: bigint) {
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
    const taxableValuePaise = lineSubtotal - allocatedDiscount;

    const taxAmountPaise = divideHalfUp(
      taxableValuePaise * parseDecimal(charge.taxRatePercent),
      10_000n,
    );

    const grossPaise = taxableValuePaise + taxAmountPaise;

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
