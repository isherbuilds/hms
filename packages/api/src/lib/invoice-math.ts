function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Division denominator must be positive");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function toPaise(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const wholePart = match[1];
  if (wholePart === undefined) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const whole = BigInt(wholePart);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const paise = whole * 100n + fraction;
  const result = Number(paise);

  if (!Number.isSafeInteger(result)) {
    throw new Error(`Money value exceeds the safe integer range: ${value}`);
  }

  return result;
}

export function fromPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Invalid paise value: ${paise}`);
  }

  const sign = paise < 0 ? "-" : "";
  const absolute = Math.abs(paise);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

export function toSignedPaise(value: string): number {
  return value.startsWith("-") ? -toPaise(value.slice(1)) : toPaise(value);
}

export type InvoiceBalance = {
  grandTotal: string;
  creditTotal: string;
  paymentsTotal: string;
  refundsTotal: string;
  outstanding: string;
};

export function calculateInvoiceBalance({
  grandTotal,
  credits,
  payments,
  refunds,
}: {
  grandTotal: string;
  credits: readonly string[];
  payments: readonly string[];
  refunds: readonly string[];
}): InvoiceBalance {
  const grandTotalPaise = toPaise(grandTotal);
  const creditTotalPaise = credits.reduce((sum, amount) => sum + toPaise(amount), 0);
  const paymentsTotalPaise = payments.reduce((sum, amount) => sum + toPaise(amount), 0);
  const refundsTotalPaise = refunds.reduce((sum, amount) => sum + toPaise(amount), 0);

  return {
    grandTotal: fromPaise(grandTotalPaise),
    creditTotal: fromPaise(creditTotalPaise),
    paymentsTotal: fromPaise(paymentsTotalPaise),
    refundsTotal: fromPaise(refundsTotalPaise),
    outstanding: fromPaise(
      grandTotalPaise - creditTotalPaise - paymentsTotalPaise + refundsTotalPaise,
    ),
  };
}

type ChargeInput = {
  chargeId: string;
  description: string;
  qty: number;
  unitPrice: string;
  taxRatePercent: string;
  taxCode: string | null;
};

type InvoiceLine = {
  chargeId: string;
  description: string;
  qty: number;
  unitPrice: string;
  lineSubtotal: string;
  allocatedDiscount: string;
  taxableValue: string;
  taxRatePercent: string;
  taxAmount: string;
  gross: string;
  taxCode: string | null;
};

export function computeInvoiceLines(
  charges: ChargeInput[],
  discountAmount: string,
): {
  lines: InvoiceLine[];
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
} {
  const discountPaise = toPaise(discountAmount);
  const preparedLines = charges.map((charge) => {
    if (!Number.isSafeInteger(charge.qty) || charge.qty < 0) {
      throw new Error(`Invalid quantity: ${charge.qty}`);
    }

    const subtotal = BigInt(toPaise(charge.unitPrice)) * BigInt(charge.qty);
    const lineSubtotal = Number(subtotal);
    if (!Number.isSafeInteger(lineSubtotal)) {
      throw new Error("Line subtotal exceeds the safe integer range");
    }
    return { charge, lineSubtotal, allocatedDiscount: 0 };
  });
  const subtotalPaise = preparedLines.reduce((sum, line) => sum + line.lineSubtotal, 0);

  if (!Number.isSafeInteger(subtotalPaise)) {
    throw new Error("Invoice subtotal exceeds the safe integer range");
  }
  if (discountPaise > subtotalPaise) {
    throw new Error("Discount cannot exceed invoice subtotal");
  }

  for (const line of preparedLines) {
    line.allocatedDiscount =
      subtotalPaise === 0
        ? 0
        : Number(
            divideHalfUp(BigInt(discountPaise) * BigInt(line.lineSubtotal), BigInt(subtotalPaise)),
          );
  }

  let largestLine: (typeof preparedLines)[number] | undefined;
  for (const line of preparedLines) {
    if (largestLine === undefined || line.lineSubtotal > largestLine.lineSubtotal) {
      largestLine = line;
    }
  }

  if (largestLine !== undefined) {
    const allocatedTotal = preparedLines.reduce((sum, line) => sum + line.allocatedDiscount, 0);
    largestLine.allocatedDiscount += discountPaise - allocatedTotal;
  }

  let taxTotalPaise = 0;
  let grandTotalPaise = 0;
  const lines = preparedLines.map(({ charge, lineSubtotal, allocatedDiscount }): InvoiceLine => {
    const taxableValuePaise = lineSubtotal - allocatedDiscount;
    const rateHundredths = toPaise(charge.taxRatePercent);
    const taxAmountPaise = Number(
      divideHalfUp(BigInt(taxableValuePaise) * BigInt(rateHundredths), 10_000n),
    );
    const grossPaise = taxableValuePaise + taxAmountPaise;

    taxTotalPaise += taxAmountPaise;
    grandTotalPaise += grossPaise;

    return {
      chargeId: charge.chargeId,
      description: charge.description,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      lineSubtotal: fromPaise(lineSubtotal),
      allocatedDiscount: fromPaise(allocatedDiscount),
      taxableValue: fromPaise(taxableValuePaise),
      taxRatePercent: charge.taxRatePercent,
      taxAmount: fromPaise(taxAmountPaise),
      gross: fromPaise(grossPaise),
      taxCode: charge.taxCode,
    };
  });

  return {
    lines,
    subtotal: fromPaise(subtotalPaise),
    taxTotal: fromPaise(taxTotalPaise),
    grandTotal: fromPaise(grandTotalPaise),
  };
}

export function derivePartialCredit(
  gross: string,
  taxRatePercent: string,
): { taxableValue: string; taxAmount: string; gross: string } {
  const grossPaise = toPaise(gross);
  const rateHundredths = toPaise(taxRatePercent);
  const taxableValuePaise = Number(
    divideHalfUp(BigInt(grossPaise) * 10_000n, 10_000n + BigInt(rateHundredths)),
  );

  return {
    taxableValue: fromPaise(taxableValuePaise),
    taxAmount: fromPaise(grossPaise - taxableValuePaise),
    gross: fromPaise(grossPaise),
  };
}

export function splitGst(taxAmount: string): { cgst: string; sgst: string } {
  const taxPaise = toPaise(taxAmount);
  const cgstPaise = Number(divideHalfUp(BigInt(taxPaise), 2n));
  return {
    cgst: fromPaise(cgstPaise),
    sgst: fromPaise(taxPaise - cgstPaise),
  };
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
