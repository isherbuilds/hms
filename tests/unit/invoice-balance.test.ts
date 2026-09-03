import { expect, test } from "bun:test";

import { invoiceBalancesFor } from "@hms/api/lib/invoice-balance";

test("loads invoice movement totals in one database round trip", async () => {
  let calls = 0;
  const executor = {
    execute: async () => {
      calls += 1;
      return {
        rows: [
          {
            invoiceId: "invoice-1",
            creditTotal: "25.00",
            paymentsTotal: "80.00",
            refundsTotal: "5.00",
          },
        ],
      };
    },
  } as unknown as Parameters<typeof invoiceBalancesFor>[0];

  const balances = await invoiceBalancesFor(executor, "org-1", [
    { id: "invoice-1", grandTotal: "100.00" },
    { id: "invoice-2", grandTotal: "40.00" },
  ]);

  expect(calls).toBe(1);
  expect(balances.get("invoice-1")).toEqual({
    grandTotal: "100.00",
    creditTotal: "25.00",
    paymentsTotal: "80.00",
    refundsTotal: "5.00",
    outstanding: "0.00",
  });
  expect(balances.get("invoice-2")?.outstanding).toBe("40.00");
});
