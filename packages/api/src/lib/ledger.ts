/**
 * Double-entry ledger primitives used by billing and statutory reports.
 * Journal dates follow the organization's configured time zone.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import type { DbTransaction } from "@hms/db/counter";
import { accounts, type AccountType } from "@hms/db/schema/accounts";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";

import { businessDate } from "./business-date";
import { fromPaise, toPaise } from "./invoice-math";

export type SystemAccountKey =
  | "cash"
  | "bank"
  | "patient_receivables"
  | "gst_output"
  | "revenue_consultation"
  | "revenue_procedure"
  | "revenue_lab"
  | "revenue_radiology"
  | "revenue_other";

export const SYSTEM_ACCOUNTS: ReadonlyArray<{
  key: SystemAccountKey;
  code: string;
  name: string;
  type: AccountType;
}> = [
  { key: "cash", code: "1000", name: "Cash in Hand", type: "asset" },
  { key: "bank", code: "1100", name: "Bank", type: "asset" },
  {
    key: "patient_receivables",
    code: "1200",
    name: "Patient Receivables",
    type: "asset",
  },
  {
    key: "gst_output",
    code: "2100",
    name: "GST Output Payable",
    type: "liability",
  },
  {
    key: "revenue_consultation",
    code: "4100",
    name: "Consultation Revenue",
    type: "income",
  },
  {
    key: "revenue_procedure",
    code: "4200",
    name: "Procedure Revenue",
    type: "income",
  },
  { key: "revenue_lab", code: "4300", name: "Lab Revenue", type: "income" },
  {
    key: "revenue_radiology",
    code: "4400",
    name: "Radiology Revenue",
    type: "income",
  },
  { key: "revenue_other", code: "4900", name: "Other Revenue", type: "income" },
];

const SYSTEM_ACCOUNT_KEYS: Record<SystemAccountKey, true> = {
  cash: true,
  bank: true,
  patient_receivables: true,
  gst_output: true,
  revenue_consultation: true,
  revenue_procedure: true,
  revenue_lab: true,
  revenue_radiology: true,
  revenue_other: true,
};

function isSystemAccountKey(value: string): value is SystemAccountKey {
  return SYSTEM_ACCOUNT_KEYS[value as SystemAccountKey] === true;
}

export function revenueAccountFor(category: string | null): SystemAccountKey {
  switch (category) {
    case "consultation":
      return "revenue_consultation";
    case "procedure":
      return "revenue_procedure";
    case "lab":
      return "revenue_lab";
    case "radiology":
      return "revenue_radiology";
    case "other":
    default:
      return "revenue_other";
  }
}

export function settlementAccountFor(method: string): SystemAccountKey {
  switch (method) {
    case "cash":
      return "cash";
    case "upi":
    case "card":
      return "bank";
    default:
      throw new Error(`Unsupported settlement method: ${method}`);
  }
}

export async function ensureChartOfAccounts(
  tx: DbTransaction,
  orgId: string,
): Promise<Record<SystemAccountKey, string>> {
  const existing = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.systemKey)));

  const accountIds = new Map<SystemAccountKey, string>();
  for (const row of existing) {
    if (row.systemKey !== null && isSystemAccountKey(row.systemKey)) {
      accountIds.set(row.systemKey, row.id);
    }
  }

  const missing = SYSTEM_ACCOUNTS.filter((account) => !accountIds.has(account.key));
  if (missing.length > 0) {
    await tx
      .insert(accounts)
      .values(
        missing.map((account) => ({
          id: crypto.randomUUID(),
          orgId,
          code: account.code,
          name: account.name,
          type: account.type,
          systemKey: account.key,
        })),
      )
      .onConflictDoNothing({ target: [accounts.orgId, accounts.code] });

    const resolved = await tx
      .select({ id: accounts.id, systemKey: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.systemKey)));
    for (const row of resolved) {
      if (row.systemKey !== null && isSystemAccountKey(row.systemKey)) {
        accountIds.set(row.systemKey, row.id);
      }
    }
  }

  const complete = {} as Record<SystemAccountKey, string>;
  for (const account of SYSTEM_ACCOUNTS) {
    const id = accountIds.get(account.key);
    if (id === undefined) {
      throw new Error(`System account could not be resolved: ${account.key}`);
    }
    complete[account.key] = id;
  }
  return complete;
}

export type JournalLineInput = {
  account: SystemAccountKey;
  debit?: string;
  credit?: string;
};

export async function postJournalEntry(
  tx: DbTransaction,
  args: {
    orgId: string;
    sourceType: string;
    sourceId: string;
    narration: string;
    createdBy: string;
    lines: JournalLineInput[];
    now: Date;
    timeZone: string;
  },
): Promise<void> {
  const preparedLines: Array<{
    account: SystemAccountKey;
    debitPaise: number;
    creditPaise: number;
  }> = [];
  let debitTotalPaise = 0;
  let creditTotalPaise = 0;

  for (const line of args.lines) {
    const hasDebit = line.debit !== undefined;
    const hasCredit = line.credit !== undefined;
    if (hasDebit === hasCredit) {
      throw new Error(`Journal line for ${line.account} must set exactly one side`);
    }

    const debitPaise = hasDebit ? toPaise(line.debit as string) : 0;
    const creditPaise = hasCredit ? toPaise(line.credit as string) : 0;
    if (debitPaise === 0 && creditPaise === 0) {
      continue;
    }

    debitTotalPaise += debitPaise;
    creditTotalPaise += creditPaise;
    if (!Number.isSafeInteger(debitTotalPaise) || !Number.isSafeInteger(creditTotalPaise)) {
      throw new Error("Journal entry total exceeds the safe integer range");
    }
    preparedLines.push({ account: line.account, debitPaise, creditPaise });
  }

  if (preparedLines.length === 0) {
    throw new Error("Journal entry must contain at least one non-zero line");
  }
  if (debitTotalPaise !== creditTotalPaise) {
    throw new Error(
      `Journal entry is imbalanced: debit ${fromPaise(debitTotalPaise)}, credit ${fromPaise(creditTotalPaise)}`,
    );
  }

  const accountIds = await ensureChartOfAccounts(tx, args.orgId);
  const entryId = crypto.randomUUID();
  await tx.insert(journalEntries).values({
    id: entryId,
    orgId: args.orgId,
    entryDate: businessDate(args.now, args.timeZone),
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    narration: args.narration,
    createdBy: args.createdBy,
  });
  await tx.insert(journalLines).values(
    preparedLines.map((line) => ({
      id: crypto.randomUUID(),
      orgId: args.orgId,
      entryId,
      accountId: accountIds[line.account],
      debit: fromPaise(line.debitPaise),
      credit: fromPaise(line.creditPaise),
    })),
  );
}
