import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";

import { appHead } from "@/config/site";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { formatBusinessDate } from "@/lib/business-date";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatDateTime, orgToday, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { saveXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports/ipd-desk")({
  head: () => appHead("IPD desk"),
  validateSearch: z.object({ asOf: z.iso.date().optional().catch(undefined) }),
  loaderDeps: ({ search: { asOf } }) => ({ asOf }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const asOf = deps.asOf ?? orgToday(timeZone);
    await loadRouteQuery(
      queryClient.query(orpc.report.ipdDesk.queryOptions({ input: { orgSlug, asOf } })),
    );

    return { asOf };
  },
  component: IpdDeskRoute,
});

const linkClass =
  "text-brand underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline";

function IpdDeskRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { asOf } = Route.useLoaderData();
  const { timeZone } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const canReadIpd = useCan(orgSlug, { ipd: ["read"] });
  const canReadBilling = useCan(orgSlug, { billing: ["read"] });
  const report = useQuery(orpc.report.ipdDesk.queryOptions({ input: { orgSlug, asOf } }));
  const download = useMutation({ ...orpc.export.ipdDeskXlsx.mutationOptions(), ...saveXlsx });

  const setAsOf = (next: string) => {
    if (!next) return;
    void navigate({ search: (current) => ({ ...current, asOf: next }), replace: true });
  };

  const stay = (row: { admissionId: string; admissionNumber: string }) =>
    canReadIpd ? (
      <Link
        to="/$orgSlug/ipd/$admissionId"
        params={{ orgSlug, admissionId: row.admissionId }}
        className={linkClass}
      >
        {row.admissionNumber}
      </Link>
    ) : (
      row.admissionNumber
    );

  return (
    <>
      <PageHeader title="IPD desk" />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid gap-1">
            <span className="text-muted-foreground">As of</span>
            <Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <ReportActions
            disabled={!report.data || download.isPending}
            onExport={() => download.mutate({ orgSlug, asOf })}
          />
        </div>

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the IPD desk report" error={report.error} />
        ) : (
          <section data-report-print className="flex flex-col gap-6">
            <header className="hidden border-b pb-2 print:block">
              <h1 className="text-sm font-medium">IPD desk</h1>
              <p>As of {formatBusinessDate(report.data.asOf)}</p>
            </header>

            <DeskSection
              title="Left with something unbilled"
              empty="Every discharged patient has been billed."
              columns={["Left", "Pending charges", "Unbilled days"]}
              rightFrom={1}
              totalLabel="Amount"
              total={formatMoney(report.data.unbilled.total, currency)}
              rows={report.data.unbilled.rows.map((row) => ({
                key: row.admissionId,
                stay: stay(row),
                patientName: row.patientName,
                mrn: row.mrn,
                cells: [
                  formatDateTime(row.dischargedAt, timeZone),
                  row.pendingCharges,
                  row.unbilledDays,
                ],
                amount: formatMoney(row.amount, currency),
              }))}
            />

            <DeskSection
              title="Unpaid bills"
              empty="No IPD bill is waiting for payment."
              columns={["Invoice number", "Date", "Invoice total"]}
              rightFrom={2}
              totalLabel="Outstanding"
              total={formatMoney(report.data.unpaid.total, currency)}
              rows={report.data.unpaid.rows.map((row) => ({
                key: row.invoiceId,
                stay: stay(row),
                patientName: row.patientName,
                mrn: row.mrn,
                cells: [
                  canReadBilling ? (
                    <Link
                      to="/$orgSlug/billing/invoices/$invoiceId"
                      params={{ orgSlug, invoiceId: row.invoiceId }}
                      className={`font-mono ${linkClass}`}
                    >
                      {row.invoiceNumber}
                    </Link>
                  ) : (
                    <span className="font-mono">{row.invoiceNumber}</span>
                  ),
                  formatBusinessDate(row.businessDate),
                  formatMoney(row.grandTotal, currency),
                ],
                amount: formatMoney(row.outstanding, currency),
              }))}
            />

            <DeskSection
              title="Deposits still held"
              empty="No deposit is held for a patient who has left."
              columns={["Stay ended"]}
              rightFrom={1}
              totalLabel="Deposit held"
              total={formatMoney(report.data.deposits.total, currency)}
              rows={report.data.deposits.rows.map((row) => ({
                key: row.admissionId,
                stay: stay(row),
                patientName: row.patientName,
                mrn: row.mrn,
                cells: [formatDateTime(row.endedAt, timeZone)],
                amount: formatMoney(row.depositHeld, currency),
              }))}
            />
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}

type DeskRow = {
  key: string;
  stay: ReactNode;
  patientName: string;
  mrn: string;
  cells: ReactNode[];
  amount: string;
};

/**
 * One exception list: the stay, the patient, the section's own columns, then the
 * amount the section totals. `rightFrom` is the first of `columns` that is numeric.
 */
function DeskSection({
  title,
  empty,
  columns,
  rightFrom,
  totalLabel,
  total,
  rows,
}: {
  title: string;
  empty: string;
  columns: string[];
  rightFrom: number;
  totalLabel: string;
  total: string;
  rows: DeskRow[];
}) {
  const align = (index: number) => (index >= rightFrom ? "text-right tabular-nums" : undefined);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <div className="ring-1 ring-border">
          <Table className="min-w-3xl print:min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">IPD No.</TableHead>
                <TableHead scope="col">Patient</TableHead>
                <TableHead scope="col">MRN</TableHead>
                {columns.map((column, index) => (
                  <TableHead scope="col" key={column} className={align(index)}>
                    {column}
                  </TableHead>
                ))}
                <TableHead scope="col" className="text-right">
                  {totalLabel}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-mono whitespace-nowrap">{row.stay}</TableCell>
                  <TableCell>{row.patientName}</TableCell>
                  <TableCell className="font-mono whitespace-nowrap">{row.mrn}</TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell
                      key={columns[index]}
                      className={`whitespace-nowrap ${align(index) ?? ""}`}
                    >
                      {cell}
                    </TableCell>
                  ))}
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {row.amount}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <TableCell colSpan={3 + columns.length}>Total</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">{total}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
