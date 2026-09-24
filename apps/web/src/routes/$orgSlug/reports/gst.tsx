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
import { z } from "zod";

import { DateFilter } from "@/components/list-filter";
import { ErrorNote, ListToolbar, PageBody, PageHeader } from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import { formatMoney } from "@/lib/money";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { orgMonthToDate as defaultRange, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports/gst")({
  head: () => ({ meta: [{ title: "GST register · HMS" }] }),
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
      queryClient.query(orpc.report.gst.queryOptions({ input: { orgSlug, ...range } })),
    );

    return range;
  },
  component: GstReportRoute,
});

function GstReportRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const { today } = useOrgDateTime();

  // Reports always read a period, so clearing the preset falls back to the route default.
  const setRange = (range: { from?: string; to?: string }) =>
    navigate({ search: range, replace: true });

  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const report = useQuery(orpc.report.gst.queryOptions({ input: { orgSlug, from, to } }));

  const exportReport = () => {
    if (!report.data) return;
    const { documents, rateSummary, hsnSummary, totals } = report.data;
    void downloadXlsx(`gst-outward-register-${from}-to-${to}.xlsx`, [
      {
        name: "Documents",
        columns: [
          { header: "Document type", key: "docType", width: 18 },
          { header: "Number", key: "number", width: 20 },
          { header: "Date", key: "date", width: 14 },
          { header: "Patient", key: "patientName", width: 28 },
          { header: "MRN", key: "patientMrn", width: 16 },
          { header: "Taxable value", key: "taxableValue", width: 17 },
          { header: "CGST", key: "cgst", width: 15 },
          { header: "SGST", key: "sgst", width: 15 },
          { header: "Tax amount", key: "taxAmount", width: 16 },
          { header: "Gross", key: "gross", width: 16 },
        ],
        rows: [
          ...documents.map((row) => ({
            docType: row.docType,
            number: row.number,
            date: row.date,
            patientName: row.patientName,
            patientMrn: row.patientMrn ?? "",
            taxableValue: Number(row.taxableValue),
            cgst: Number(row.cgst),
            sgst: Number(row.sgst),
            taxAmount: Number(row.taxAmount),
            gross: Number(row.gross),
          })),
          {
            docType: "",
            number: "Total",
            date: "",
            patientName: "",
            patientMrn: "",
            taxableValue: Number(totals.taxableValue),
            cgst: Number(totals.cgst),
            sgst: Number(totals.sgst),
            taxAmount: Number(totals.taxAmount),
            gross: Number(totals.gross),
          },
        ],
      },
      {
        name: "Rate summary",
        columns: [
          { header: "GST rate %", key: "taxRatePercent", width: 14 },
          { header: "Taxable value", key: "taxableValue", width: 17 },
          { header: "CGST", key: "cgst", width: 15 },
          { header: "SGST", key: "sgst", width: 15 },
          { header: "Tax amount", key: "taxAmount", width: 16 },
        ],
        rows: [
          ...rateSummary.map((row) => ({
            taxRatePercent: Number(row.taxRatePercent),
            taxableValue: Number(row.taxableValue),
            cgst: Number(row.cgst),
            sgst: Number(row.sgst),
            taxAmount: Number(row.taxAmount),
          })),
          {
            taxRatePercent: "Total",
            taxableValue: Number(totals.taxableValue),
            cgst: Number(totals.cgst),
            sgst: Number(totals.sgst),
            taxAmount: Number(totals.taxAmount),
          },
        ],
      },
      {
        name: "HSN summary",
        columns: [
          { header: "HSN/SAC", key: "taxCode", width: 18 },
          { header: "GST rate %", key: "taxRatePercent", width: 14 },
          { header: "Taxable value", key: "taxableValue", width: 17 },
          { header: "Tax amount", key: "taxAmount", width: 16 },
        ],
        rows: [
          ...hsnSummary.map((row) => ({
            taxCode: row.taxCode,
            taxRatePercent: Number(row.taxRatePercent),
            taxableValue: Number(row.taxableValue),
            taxAmount: Number(row.taxAmount),
          })),
          {
            taxCode: "Total",
            taxRatePercent: "",
            taxableValue: Number(totals.taxableValue),
            taxAmount: Number(totals.taxAmount),
          },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="GST register"
        action={<ReportActions disabled={!report.data} onExport={exportReport} />}
      />
      <PageBody>
        <div className="print:hidden">
          <ListToolbar>
            <DateFilter today={today} from={from} to={to} maxDays={366} onChange={setRange} />
          </ListToolbar>
        </div>

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the GST outward register" error={report.error} />
        ) : (
          <section data-report-print className="flex flex-col gap-4">
            <header className="border-b pb-2">
              <h1 className="text-sm font-medium">GST outward register</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to} · CGST/SGST split assumes intra-state supply.
              </p>
            </header>

            <section className="flex flex-col gap-2">
              <h2 className="min-h-6 text-muted-foreground">Documents</h2>
              <div className="ring-1 ring-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>MRN</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data.documents.map((row) => (
                      <TableRow key={`${row.docType}-${row.number}`}>
                        <TableCell className="capitalize">
                          {row.docType.replace("_", " ")}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{row.number}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{row.date}</TableCell>
                        <TableCell className="capitalize">{row.patientName}</TableCell>
                        <TableCell className="font-mono">{row.patientMrn}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.taxableValue, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.cgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.sgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.taxAmount, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(row.gross, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={5}>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(report.data.totals.taxableValue, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(report.data.totals.cgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(report.data.totals.sgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(report.data.totals.taxAmount, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(report.data.totals.gross, currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="flex flex-col gap-2">
                <h2 className="min-h-6 text-muted-foreground">Rate summary</h2>
                <div className="ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.data.rateSummary.map((row) => (
                        <TableRow key={row.taxRatePercent}>
                          <TableCell className="font-medium tabular-nums">
                            {row.taxRatePercent}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxableValue, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.cgst, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.sgst, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxAmount, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.taxableValue, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.cgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.sgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.taxAmount, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <h2 className="min-h-6 text-muted-foreground">HSN/SAC summary</h2>
                <div className="ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>HSN/SAC</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.data.hsnSummary.map((row) => (
                        <TableRow key={`${row.taxCode}-${row.taxRatePercent}`}>
                          <TableCell className="font-mono font-medium">
                            {row.taxCode || "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">{row.taxRatePercent}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxableValue, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxAmount, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.taxableValue, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.taxAmount, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
