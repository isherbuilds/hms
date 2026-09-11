import { expect, test } from "bun:test";

import { parseDecimal } from "@hms/api/core/money";
import { invoiceBalancesFor } from "@hms/api/lib/invoice-balance";

test("loads invoice movement totals in one database round trip", async () => {
  let calls = 0;

  // SAFETY: the stub only needs `execute`, the one method invoiceBalancesFor calls.
  const executor = {
    execute: async () => {
      calls += 1;

      return {
        rows: [
          {
            invoiceId: "invoice-1",
            creditTotal: "2500",
            paymentsTotal: "8000",
            refundsTotal: "500",
          },
        ],
      };
    },
  } as never;

  const balances = await invoiceBalancesFor(executor, "org-1", [
    { id: "invoice-1", grandTotal: parseDecimal("100.00") },
    { id: "invoice-2", grandTotal: parseDecimal("40.00") },
  ]);

  expect(calls).toBe(1);
  expect(balances.get("invoice-1")).toEqual({
    grandTotal: parseDecimal("100.00"),
    creditTotal: parseDecimal("25.00"),
    paymentsTotal: parseDecimal("80.00"),
    refundsTotal: parseDecimal("5.00"),
    outstanding: parseDecimal("0.00"),
  });
  expect(balances.get("invoice-2")?.outstanding).toBe(parseDecimal("40.00"));
});
