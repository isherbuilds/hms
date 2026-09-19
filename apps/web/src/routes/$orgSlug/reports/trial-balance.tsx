import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { z } from "zod";

import { DateFilter } from "@/components/list-filter";
import { ErrorNote, ListToolbar, PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import { formatMoney } from "@/lib/money";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { orgMonthToDate as defaultRange, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports/trial-balance")({
  head: () => ({ meta: [{ title: "Trial balance · HMS" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const fallback = defaultRange(timeZone);
    const range = { from: deps.from ?? fallback.from, to: deps.to ?? fallback.to };
    await loadRouteQuery(
      queryClient.query(orpc.report.trialBalance.queryOptions({ input: { orgSlug, ...range } })),
    );

    return range;
  },
  component: TrialBalanceRoute,
});

function TrialBalanceRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const { today } = useOrgDateTime();

  // Reports always read a period, so clearing the preset falls back to the route default.
  const setRange = (range: { from?: string; to?: string }) =>
    navigate({ search: range, replace: true });

  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const report = useQuery(orpc.report.trialBalance.queryOptions({ input: { orgSlug, from, to } }));

  const exportReport = () => {
    if (!report.data) return;
    const { rows, totals } = report.data;
    void downloadXlsx(`trial-balance-${from}-to-${to}.xlsx`, [
      {
        name: "Trial balance",
        columns: [
          { header: "Code", key: "code", width: 14 },
          { header: "Account", key: "name", width: 32 },
          { header: "Type", key: "type", width: 14 },
          { header: "Opening debit", key: "openingDebit", width: 16 },
          { header: "Opening credit", key: "openingCredit", width: 16 },
          { header: "Debit", key: "debit", width: 16 },
          { header: "Credit", key: "credit", width: 16 },
          { header: "Closing debit", key: "closingDebit", width: 16 },
          { header: "Closing credit", key: "closingCredit", width: 16 },
        ],
        rows: [
          ...rows.map((row) => ({
            code: row.code,
            name: row.name,
            type: row.type,
            openingDebit: Number(row.openingDebit),
            openingCredit: Number(row.openingCredit),
            debit: Number(row.debit),
            credit: Number(row.credit),
            closingDebit: Number(row.closingDebit),
            closingCredit: Number(row.closingCredit),
          })),
          {
            code: "",
            name: "Total",
            type: "",
            openingDebit: Number(totals.openingDebit),
            openingCredit: Number(totals.openingCredit),
            debit: Number(totals.debit),
            credit: Number(totals.credit),
            closingDebit: Number(totals.closingDebit),
            closingCredit: Number(totals.closingCredit),
          },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Trial balance"
        action={
          <>
            <Button disabled={!report.data} onClick={exportReport}>
              <DownloadIcon data-icon="inline-start" />
              Export Excel
            </Button>
            <Button variant="outline" disabled={!report.data} onClick={() => window.print()}>
              <PrinterIcon data-icon="inline-start" />
              Print / PDF
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="print:hidden">
          <ListToolbar>
            <DateFilter today={today} from={from} to={to} onChange={setRange} />
          </ListToolbar>
        </div>
        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the trial balance" error={report.error} />
        ) : (
          <section data-report-print className="space-y-3">
            <header className="border-b pb-2">
              <h1 className="text-sm font-medium">Trial balance</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to}
              </p>
            </header>
            <div className="overflow-x-auto ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Opening debit</TableHead>
                    <TableHead className="text-right">Opening credit</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Closing debit</TableHead>
                    <TableHead className="text-right">Closing credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.rows.map((row) => (
                    <TableRow key={row.accountId}>
                      <TableCell className="font-mono font-medium">{row.code}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{row.type}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.openingDebit, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.openingCredit, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.debit, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.credit, currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(row.closingDebit, currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(row.closingCredit, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.openingDebit, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.openingCredit, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.debit, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.credit, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.closingDebit, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.closingCredit, currency)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
