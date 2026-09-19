import { splitGst } from "./invoice-math";

export type AccountAggregate = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  debit: bigint;
  credit: bigint;
};

export type GstBucket = {
  docType: "invoice" | "credit_note";
  documentId: string;
  number: string;
  date: string;
  patientName: string;
  patientMrn: string | null;
  taxRatePercent: string;
  taxCode: string | null;
  taxableValue: bigint;
  taxAmount: bigint;
  gross: bigint;
};

function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
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
      openingPaise: bigint;
      debitPaise: bigint;
      creditPaise: bigint;
    }
  >();

  for (const row of openingRows) {
    byAccount.set(row.accountId, {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      openingPaise: row.debit - row.credit,
      debitPaise: 0n,
      creditPaise: 0n,
    });
  }

  for (const row of activityRows) {
    const existing = byAccount.get(row.accountId);
    byAccount.set(row.accountId, {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      openingPaise: existing?.openingPaise ?? 0n,
      debitPaise: row.debit,
      creditPaise: row.credit,
    });
  }

  const totals = {
    openingDebit: 0n,
    openingCredit: 0n,
    debit: 0n,
    credit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  };

  const rows = [...byAccount.values()]
    .filter((row) => row.openingPaise !== 0n || row.debitPaise !== 0n || row.creditPaise !== 0n)
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((row) => {
      const closingPaise = row.openingPaise + row.debitPaise - row.creditPaise;

      const line = {
        openingDebit: positive(row.openingPaise),
        openingCredit: positive(-row.openingPaise),
        debit: row.debitPaise,
        credit: row.creditPaise,
        closingDebit: positive(closingPaise),
        closingCredit: positive(-closingPaise),
      };

      totals.openingDebit += line.openingDebit;
      totals.openingCredit += line.openingCredit;
      totals.debit += line.debit;
      totals.credit += line.credit;
      totals.closingDebit += line.closingDebit;
      totals.closingCredit += line.closingCredit;

      return {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        type: row.type,
        openingDebit: line.openingDebit,
        openingCredit: line.openingCredit,
        debit: line.debit,
        credit: line.credit,
        closingDebit: line.closingDebit,
        closingCredit: line.closingCredit,
      };
    });

  return {
    from,
    to,
    rows,
    totals: {
      openingDebit: totals.openingDebit,
      openingCredit: totals.openingCredit,
      debit: totals.debit,
      credit: totals.credit,
      closingDebit: totals.closingDebit,
      closingCredit: totals.closingCredit,
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
  type Line = { code: string; name: string; balance: bigint };

  const assets: Line[] = [];
  const liabilities: Line[] = [];
  const equity: Line[] = [];
  let surplusPaise = 0n;

  for (const row of aggregates) {
    const debitBalance = row.debit - row.credit;
    const creditBalance = -debitBalance;

    if (row.type === "asset" && debitBalance !== 0n) {
      assets.push({ code: row.code, name: row.name, balance: debitBalance });
    } else if (row.type === "liability" && creditBalance !== 0n) {
      liabilities.push({ code: row.code, name: row.name, balance: creditBalance });
    } else if (row.type === "equity" && creditBalance !== 0n) {
      equity.push({ code: row.code, name: row.name, balance: creditBalance });
    } else if (row.type === "income") {
      surplusPaise += creditBalance;
    } else if (row.type === "expense") {
      surplusPaise -= debitBalance;
    }
  }

  if (surplusPaise !== 0n) {
    equity.push({ code: "3900", name: "Current surplus", balance: surplusPaise });
  }

  const byCode = (left: Line, right: Line) => left.code.localeCompare(right.code);
  const present = (rows: Line[]) => rows.sort(byCode);
  const sum = (rows: Line[]) => rows.reduce((total, row) => total + row.balance, 0n);

  return {
    asOf,
    assets: present(assets),
    liabilities: present(liabilities),
    equity: present(equity),
    totals: {
      assets: sum(assets),
      liabilitiesAndEquity: sum(liabilities) + sum(equity),
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
      patientMrn: string | null;
      taxableValuePaise: bigint;
      cgstPaise: bigint;
      sgstPaise: bigint;
      taxAmountPaise: bigint;
      grossPaise: bigint;
    }
  >();

  const rateMap = new Map<
    string,
    {
      taxableValuePaise: bigint;
      cgstPaise: bigint;
      sgstPaise: bigint;
      taxAmountPaise: bigint;
    }
  >();

  const gstSplitMap = new Map<
    string,
    { documentKey: string; taxRatePercent: string; taxAmountPaise: bigint }
  >();

  const hsnMap = new Map<
    string,
    { taxCode: string; taxRatePercent: string; taxableValuePaise: bigint; taxAmountPaise: bigint }
  >();

  for (const bucket of buckets) {
    const direction = bucket.docType === "credit_note" ? -1n : 1n;
    const taxableValuePaise = direction * bucket.taxableValue;
    const taxAmountPaise = direction * bucket.taxAmount;
    const grossPaise = direction * bucket.gross;
    const documentKey = `${bucket.docType}:${bucket.documentId}`;

    const document = documentMap.get(documentKey) ?? {
      docType: bucket.docType,
      number: bucket.number,
      date: bucket.date,
      patientName: bucket.patientName,
      patientMrn: bucket.patientMrn,
      taxableValuePaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      taxAmountPaise: 0n,
      grossPaise: 0n,
    };

    document.taxableValuePaise += taxableValuePaise;
    document.taxAmountPaise += taxAmountPaise;
    document.grossPaise += grossPaise;
    documentMap.set(documentKey, document);

    const rate = rateMap.get(bucket.taxRatePercent) ?? {
      taxableValuePaise: 0n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      taxAmountPaise: 0n,
    };

    rate.taxableValuePaise += taxableValuePaise;
    rate.taxAmountPaise += taxAmountPaise;
    rateMap.set(bucket.taxRatePercent, rate);

    const gstSplitKey = `${documentKey}\u0000${bucket.taxRatePercent}`;

    const gstSplit = gstSplitMap.get(gstSplitKey) ?? {
      documentKey,
      taxRatePercent: bucket.taxRatePercent,
      taxAmountPaise: 0n,
    };

    gstSplit.taxAmountPaise += taxAmountPaise;
    gstSplitMap.set(gstSplitKey, gstSplit);

    const taxCode = bucket.taxCode ?? "";
    const hsnKey = `${taxCode}\u0000${bucket.taxRatePercent}`;

    const hsn = hsnMap.get(hsnKey) ?? {
      taxCode,
      taxRatePercent: bucket.taxRatePercent,
      taxableValuePaise: 0n,
      taxAmountPaise: 0n,
    };

    hsn.taxableValuePaise += taxableValuePaise;
    hsn.taxAmountPaise += taxAmountPaise;
    hsnMap.set(hsnKey, hsn);
  }

  for (const splitBucket of gstSplitMap.values()) {
    const { cgst, sgst } = splitGst(splitBucket.taxAmountPaise);
    const document = documentMap.get(splitBucket.documentKey);
    const rate = rateMap.get(splitBucket.taxRatePercent);

    if (!document || !rate) {
      throw new Error("GST report split bucket is missing its aggregate");
    }

    document.cgstPaise += cgst;
    document.sgstPaise += sgst;
    rate.cgstPaise += cgst;
    rate.sgstPaise += sgst;
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
      taxableValue: document.taxableValuePaise,
      cgst: document.cgstPaise,
      sgst: document.sgstPaise,
      taxAmount: document.taxAmountPaise,
      gross: document.grossPaise,
    }));

  const rateSummary = [...rateMap.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([taxRatePercent, bucket]) => ({
      taxRatePercent,
      taxableValue: bucket.taxableValuePaise,
      cgst: bucket.cgstPaise,
      sgst: bucket.sgstPaise,
      taxAmount: bucket.taxAmountPaise,
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
      taxableValue: bucket.taxableValuePaise,
      taxAmount: bucket.taxAmountPaise,
    }));

  const totals = {
    taxableValuePaise: 0n,
    cgstPaise: 0n,
    sgstPaise: 0n,
    taxAmountPaise: 0n,
    grossPaise: 0n,
  };

  for (const row of documentMap.values()) {
    totals.taxableValuePaise += row.taxableValuePaise;
    totals.cgstPaise += row.cgstPaise;
    totals.sgstPaise += row.sgstPaise;
    totals.taxAmountPaise += row.taxAmountPaise;
    totals.grossPaise += row.grossPaise;
  }

  return {
    from,
    to,
    documents,
    rateSummary,
    hsnSummary,
    totals: {
      taxableValue: totals.taxableValuePaise,
      cgst: totals.cgstPaise,
      sgst: totals.sgstPaise,
      taxAmount: totals.taxAmountPaise,
      gross: totals.grossPaise,
    },
  };
}
