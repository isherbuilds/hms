import { fromPaise, splitGst, toPaise, toSignedPaise } from "./invoice-math";

export type AccountAggregate = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  debit: string;
  credit: string;
};

export type GstBucket = {
  docType: "invoice" | "credit_note";
  documentId: string;
  number: string;
  date: string;
  patientName: string;
  patientMrn: string;
  taxRatePercent: string;
  taxCode: string | null;
  taxableValue: string;
  taxAmount: string;
  gross: string;
};

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("Report amount exceeds the safe integer range");
  }
  return result;
}

function moneySum(rows: readonly string[]): number {
  return rows.reduce((total, value) => checkedAdd(total, toSignedPaise(value)), 0);
}

function splitSignedGstPaise(taxAmountPaise: number): { cgstPaise: number; sgstPaise: number } {
  const sign = taxAmountPaise < 0 ? -1 : 1;
  const split = splitGst(fromPaise(Math.abs(taxAmountPaise)));
  return {
    cgstPaise: sign * toPaise(split.cgst),
    sgstPaise: sign * toPaise(split.sgst),
  };
}

export function buildTrialBalance({
  from,
  to,
  openingRows,
  activityRows,
}: {
  from: string;
  to: string;
  openingRows: readonly AccountAggregate[];
  activityRows: readonly AccountAggregate[];
}) {
  const byAccount = new Map<
    string,
    Omit<AccountAggregate, "debit" | "credit"> & {
      openingPaise: number;
      debitPaise: number;
      creditPaise: number;
    }
  >();

  for (const row of openingRows) {
    byAccount.set(row.accountId, {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      openingPaise: checkedAdd(toPaise(row.debit), -toPaise(row.credit)),
      debitPaise: 0,
      creditPaise: 0,
    });
  }
  for (const row of activityRows) {
    const existing = byAccount.get(row.accountId);
    byAccount.set(row.accountId, {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      openingPaise: existing?.openingPaise ?? 0,
      debitPaise: toPaise(row.debit),
      creditPaise: toPaise(row.credit),
    });
  }

  const rows = [...byAccount.values()]
    .filter((row) => row.openingPaise !== 0 || row.debitPaise !== 0 || row.creditPaise !== 0)
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((row) => {
      const closingPaise = checkedAdd(
        checkedAdd(row.openingPaise, row.debitPaise),
        -row.creditPaise,
      );
      return {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        type: row.type,
        openingDebit: fromPaise(Math.max(row.openingPaise, 0)),
        openingCredit: fromPaise(Math.max(-row.openingPaise, 0)),
        debit: fromPaise(row.debitPaise),
        credit: fromPaise(row.creditPaise),
        closingDebit: fromPaise(Math.max(closingPaise, 0)),
        closingCredit: fromPaise(Math.max(-closingPaise, 0)),
      };
    });

  return {
    from,
    to,
    rows,
    totals: {
      openingDebit: fromPaise(moneySum(rows.map((row) => row.openingDebit))),
      openingCredit: fromPaise(moneySum(rows.map((row) => row.openingCredit))),
      debit: fromPaise(moneySum(rows.map((row) => row.debit))),
      credit: fromPaise(moneySum(rows.map((row) => row.credit))),
      closingDebit: fromPaise(moneySum(rows.map((row) => row.closingDebit))),
      closingCredit: fromPaise(moneySum(rows.map((row) => row.closingCredit))),
    },
  };
}

export function buildBalanceSheet({
  asOf,
  aggregates,
}: {
  asOf: string;
  aggregates: readonly AccountAggregate[];
}) {
  const assets: Array<{ code: string; name: string; balance: string }> = [];
  const liabilities: Array<{ code: string; name: string; balance: string }> = [];
  const equity: Array<{ code: string; name: string; balance: string }> = [];
  let surplusPaise = 0;

  for (const row of aggregates) {
    const debitPaise = toPaise(row.debit);
    const creditPaise = toPaise(row.credit);
    const debitBalance = checkedAdd(debitPaise, -creditPaise);
    const creditBalance = checkedAdd(creditPaise, -debitPaise);

    if (row.type === "asset" && debitBalance !== 0) {
      assets.push({ code: row.code, name: row.name, balance: fromPaise(debitBalance) });
    } else if (row.type === "liability" && creditBalance !== 0) {
      liabilities.push({ code: row.code, name: row.name, balance: fromPaise(creditBalance) });
    } else if (row.type === "equity" && creditBalance !== 0) {
      equity.push({ code: row.code, name: row.name, balance: fromPaise(creditBalance) });
    } else if (row.type === "income") {
      surplusPaise = checkedAdd(surplusPaise, creditBalance);
    } else if (row.type === "expense") {
      surplusPaise = checkedAdd(surplusPaise, -debitBalance);
    }
  }

  if (surplusPaise !== 0) {
    equity.push({ code: "3900", name: "Current surplus", balance: fromPaise(surplusPaise) });
  }
  assets.sort((left, right) => left.code.localeCompare(right.code));
  liabilities.sort((left, right) => left.code.localeCompare(right.code));
  equity.sort((left, right) => left.code.localeCompare(right.code));

  return {
    asOf,
    assets,
    liabilities,
    equity,
    totals: {
      assets: fromPaise(moneySum(assets.map((row) => row.balance))),
      liabilitiesAndEquity: fromPaise(
        moneySum([...liabilities, ...equity].map((row) => row.balance)),
      ),
    },
  };
}

export function buildGstReport({
  from,
  to,
  buckets,
}: {
  from: string;
  to: string;
  buckets: readonly GstBucket[];
}) {
  const documentMap = new Map<
    string,
    {
      docType: "invoice" | "credit_note";
      number: string;
      date: string;
      patientName: string;
      patientMrn: string;
      taxableValuePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      taxAmountPaise: number;
      grossPaise: number;
    }
  >();
  const rateMap = new Map<
    string,
    {
      taxableValuePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      taxAmountPaise: number;
    }
  >();
  const gstSplitMap = new Map<
    string,
    { documentKey: string; taxRatePercent: string; taxAmountPaise: number }
  >();
  const hsnMap = new Map<
    string,
    { taxCode: string; taxRatePercent: string; taxableValuePaise: number; taxAmountPaise: number }
  >();

  for (const bucket of buckets) {
    const direction = bucket.docType === "credit_note" ? -1 : 1;
    const taxableValuePaise = direction * toPaise(bucket.taxableValue);
    const taxAmountPaise = direction * toPaise(bucket.taxAmount);
    const grossPaise = direction * toPaise(bucket.gross);
    const documentKey = `${bucket.docType}:${bucket.documentId}`;
    const document = documentMap.get(documentKey) ?? {
      docType: bucket.docType,
      number: bucket.number,
      date: bucket.date,
      patientName: bucket.patientName,
      patientMrn: bucket.patientMrn,
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      taxAmountPaise: 0,
      grossPaise: 0,
    };
    document.taxableValuePaise = checkedAdd(document.taxableValuePaise, taxableValuePaise);
    document.taxAmountPaise = checkedAdd(document.taxAmountPaise, taxAmountPaise);
    document.grossPaise = checkedAdd(document.grossPaise, grossPaise);
    documentMap.set(documentKey, document);

    const rate = rateMap.get(bucket.taxRatePercent) ?? {
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      taxAmountPaise: 0,
    };
    rate.taxableValuePaise = checkedAdd(rate.taxableValuePaise, taxableValuePaise);
    rate.taxAmountPaise = checkedAdd(rate.taxAmountPaise, taxAmountPaise);
    rateMap.set(bucket.taxRatePercent, rate);

    const gstSplitKey = `${documentKey}\u0000${bucket.taxRatePercent}`;
    const gstSplit = gstSplitMap.get(gstSplitKey) ?? {
      documentKey,
      taxRatePercent: bucket.taxRatePercent,
      taxAmountPaise: 0,
    };
    gstSplit.taxAmountPaise = checkedAdd(gstSplit.taxAmountPaise, taxAmountPaise);
    gstSplitMap.set(gstSplitKey, gstSplit);

    const taxCode = bucket.taxCode ?? "";
    const hsnKey = `${taxCode}\u0000${bucket.taxRatePercent}`;
    const hsn = hsnMap.get(hsnKey) ?? {
      taxCode,
      taxRatePercent: bucket.taxRatePercent,
      taxableValuePaise: 0,
      taxAmountPaise: 0,
    };
    hsn.taxableValuePaise = checkedAdd(hsn.taxableValuePaise, taxableValuePaise);
    hsn.taxAmountPaise = checkedAdd(hsn.taxAmountPaise, taxAmountPaise);
    hsnMap.set(hsnKey, hsn);
  }

  for (const splitBucket of gstSplitMap.values()) {
    const { cgstPaise, sgstPaise } = splitSignedGstPaise(splitBucket.taxAmountPaise);
    const document = documentMap.get(splitBucket.documentKey);
    const rate = rateMap.get(splitBucket.taxRatePercent);
    if (!document || !rate) {
      throw new Error("GST report split bucket is missing its aggregate");
    }
    document.cgstPaise = checkedAdd(document.cgstPaise, cgstPaise);
    document.sgstPaise = checkedAdd(document.sgstPaise, sgstPaise);
    rate.cgstPaise = checkedAdd(rate.cgstPaise, cgstPaise);
    rate.sgstPaise = checkedAdd(rate.sgstPaise, sgstPaise);
  }

  const documents = [...documentMap.values()]
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.number.localeCompare(right.number),
    )
    .map((document) => ({
      docType: document.docType,
      number: document.number,
      date: document.date,
      patientName: document.patientName,
      patientMrn: document.patientMrn,
      taxableValue: fromPaise(document.taxableValuePaise),
      cgst: fromPaise(document.cgstPaise),
      sgst: fromPaise(document.sgstPaise),
      taxAmount: fromPaise(document.taxAmountPaise),
      gross: fromPaise(document.grossPaise),
    }));

  const rateSummary = [...rateMap.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([taxRatePercent, bucket]) => ({
      taxRatePercent,
      taxableValue: fromPaise(bucket.taxableValuePaise),
      cgst: fromPaise(bucket.cgstPaise),
      sgst: fromPaise(bucket.sgstPaise),
      taxAmount: fromPaise(bucket.taxAmountPaise),
    }));

  const hsnSummary = [...hsnMap.values()]
    .sort(
      (left, right) =>
        left.taxCode.localeCompare(right.taxCode) ||
        Number(left.taxRatePercent) - Number(right.taxRatePercent),
    )
    .map((bucket) => ({
      taxCode: bucket.taxCode,
      taxRatePercent: bucket.taxRatePercent,
      taxableValue: fromPaise(bucket.taxableValuePaise),
      taxAmount: fromPaise(bucket.taxAmountPaise),
    }));

  const documentAggregates = [...documentMap.values()];
  const taxableValuePaise = documentAggregates.reduce(
    (total, row) => checkedAdd(total, row.taxableValuePaise),
    0,
  );
  const cgstPaise = documentAggregates.reduce((total, row) => checkedAdd(total, row.cgstPaise), 0);
  const sgstPaise = documentAggregates.reduce((total, row) => checkedAdd(total, row.sgstPaise), 0);
  const taxAmountPaise = documentAggregates.reduce(
    (total, row) => checkedAdd(total, row.taxAmountPaise),
    0,
  );
  const grossPaise = documentAggregates.reduce(
    (total, row) => checkedAdd(total, row.grossPaise),
    0,
  );

  return {
    from,
    to,
    documents,
    rateSummary,
    hsnSummary,
    totals: {
      taxableValue: fromPaise(taxableValuePaise),
      cgst: fromPaise(cgstPaise),
      sgst: fromPaise(sgstPaise),
      taxAmount: fromPaise(taxAmountPaise),
      gross: fromPaise(grossPaise),
    },
  };
}
