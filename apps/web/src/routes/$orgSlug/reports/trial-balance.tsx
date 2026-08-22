import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import {
  REPORT_PRINT_LANDSCAPE_CSS,
  formatReportMoney,
  validateReportPeriod,
} from "@/lib/report-presentation";
import { orgMonthToDate as defaultRange } from "@/lib/org-datetime";

export const Route = createFileRoute("/$orgSlug/reports/trial-balance")({
  head: () => ({ meta: [{ title: "Trial balance · HMS" }] }),
  // `.catch` keeps a hand-edited or truncated URL on the page: a date that does
  // not parse falls back to the default range instead of an error screen.
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  /**
   * The loader resolves the range and the component reads that same object
   * back, so the key we prefetch and the key we render cannot drift apart.
   * `member.me` already carries the org time zone and the parent org loader
   * has it in flight, so this awaits a deduplicated request, not a second one.
   */
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await queryClient.ensureQueryData(
      orpc.member.me.queryOptions({ input: { orgSlug } }),
    );
    const fallback = defaultRange(timeZone);
    const range = { from: deps.from ?? fallback.from, to: deps.to ?? fallback.to };
    await loadRouteQuery(
      queryClient.fetchQuery(
        orpc.report.trialBalance.queryOptions({ input: { orgSlug, ...range } }),
      ),
    );
    return range;
  },
  component: TrialBalanceRoute,
});

function TrialBalanceRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const report = useQuery(orpc.report.trialBalance.queryOptions({ input: { orgSlug, from, to } }));
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  const periodError = validateReportPeriod(draft.from, draft.to);
  const money = (value: string) => formatReportMoney(value, membership.data.currency);

  const applyRange = () => {
    if (periodError) return;
    void navigate({ search: draft, replace: true });
  };

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
      <PageHeader title="Trial balance" description="Account movement for a selected period" />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid gap-1">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              value={draft.from}
              onChange={(event) =>
                setDraft((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">To</span>
            <Input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
          <Button
            size="sm"
            disabled={Boolean(periodError) || (draft.from === from && draft.to === to)}
            onClick={applyRange}
          >
            Apply
          </Button>
          <Button size="sm" variant="outline" disabled={!report.data} onClick={exportReport}>
            <DownloadIcon data-icon="inline-start" />
            Export Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!report.data}
            onClick={() => window.print()}
          >
            <PrinterIcon data-icon="inline-start" />
            Print / PDF
          </Button>
        </div>
        {periodError ? (
          <p role="alert" className="text-destructive">
            {periodError}
          </p>
        ) : null}

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the trial balance" detail={report.error.message} />
        ) : (
          <section data-report-print className="space-y-3">
            <header className="border-b pb-2">
              <h1 className="text-sm font-semibold">Trial balance</h1>
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
                      <TableCell className="font-medium tabular-nums">{row.code}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{row.type}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.openingDebit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.openingCredit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.debit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.credit)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(row.closingDebit)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(row.closingCredit)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.openingDebit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.openingCredit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.debit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.credit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.closingDebit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(report.data.totals.closingCredit)}
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
