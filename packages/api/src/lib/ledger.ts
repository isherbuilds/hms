import { and, eq, isNotNull } from "drizzle-orm";

import type { DbTransaction } from "@hms/db/counter";
import { accounts, type AccountType } from "@hms/db/schema/accounts";
import type { CatalogCategory } from "@hms/db/schema/catalog-items";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";

import { formatDecimal } from "../core/money";
import { businessDate } from "./business-date";

const SYSTEM_ACCOUNTS = [
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
    key: "patient_advances",
    code: "2200",
    name: "Patient Advances",
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
] as const satisfies ReadonlyArray<{
  key: string;
  code: string;
  name: string;
  type: AccountType;
}>;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]["key"];

function isSystemAccountKey(value: string): value is SystemAccountKey {
  return SYSTEM_ACCOUNTS.some((account) => account.key === value);
}

const REVENUE_ACCOUNTS: Record<CatalogCategory, SystemAccountKey> = {
  consultation: "revenue_consultation",
  procedure: "revenue_procedure",
  lab: "revenue_lab",
  radiology: "revenue_radiology",
  other: "revenue_other",
};

export function revenueAccountFor(category: CatalogCategory): SystemAccountKey {
  return REVENUE_ACCOUNTS[category];
}

export function settlementAccountFor(method: string): SystemAccountKey {
  switch (method) {
    case "cash":
      return "cash";
    case "upi":
    case "card":
    case "bank":
      return "bank";
    default:
      throw new Error(`Unsupported settlement method: ${method}`);
  }
}

async function ensureChartOfAccounts(
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
          id: Bun.randomUUIDv7(),
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

  // SAFETY: the loop below fills every SYSTEM_ACCOUNTS key or throws.
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

type JournalLineInput = {
  account: SystemAccountKey;
  debit?: bigint;
  credit?: bigint;
};

type JournalEntryInput = {
  sourceType: string;
  sourceId: string;
  narration: string;
  createdBy: string;
  lines: JournalLineInput[];
  now: Date;
  timeZone: string;
};

function prepareLines(entry: JournalEntryInput) {
  const preparedLines: Array<{
    account: SystemAccountKey;
    debit: bigint;
    credit: bigint;
  }> = [];

  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of entry.lines) {
    const hasDebit = line.debit !== undefined;
    const hasCredit = line.credit !== undefined;

    if (hasDebit === hasCredit) {
      throw new Error(`Journal line for ${line.account} must set exactly one side`);
    }

    const debit = line.debit ?? 0n;
    const credit = line.credit ?? 0n;

    if (debit === 0n && credit === 0n) {
      continue;
    }

    debitTotal += debit;
    creditTotal += credit;
    preparedLines.push({ account: line.account, debit, credit });
  }

  if (preparedLines.length === 0) {
    throw new Error("Journal entry must contain at least one non-zero line");
  }

  if (debitTotal !== creditTotal) {
    throw new Error(
      `Journal entry is imbalanced: debit ${formatDecimal(debitTotal)}, credit ${formatDecimal(creditTotal)}`,
    );
  }

  return preparedLines;
}

/** Each entry balances on its own; all of them cost one account read and two inserts. */
export async function postJournalEntries(
  tx: DbTransaction,
  orgId: string,
  entries: JournalEntryInput[],
): Promise<void> {
  if (entries.length === 0) return;

  const prepared = entries.map((entry) => ({
    entry,
    entryId: Bun.randomUUIDv7(),
    lines: prepareLines(entry),
  }));

  const accountIds = await ensureChartOfAccounts(tx, orgId);

  await tx.insert(journalEntries).values(
    prepared.map(({ entry, entryId }) => ({
      id: entryId,
      orgId,
      entryDate: businessDate(entry.now, entry.timeZone),
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      narration: entry.narration,
      createdBy: entry.createdBy,
    })),
  );
  await tx.insert(journalLines).values(
    prepared.flatMap(({ entryId, lines }) =>
      lines.map((line) => ({
        id: Bun.randomUUIDv7(),
        orgId,
        entryId,
        accountId: accountIds[line.account],
        debit: line.debit,
        credit: line.credit,
      })),
    ),
  );
}
