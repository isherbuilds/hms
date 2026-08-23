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

export const Route = createFileRoute("/$orgSlug/reports/gst")({
  head: () => ({ meta: [{ title: "GST outward register · HMS" }] }),
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
      queryClient.fetchQuery(orpc.report.gst.queryOptions({ input: { orgSlug, ...range } })),
    );
    return range;
  },
  component: GstReportRoute,
});

function GstReportRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const report = useQuery(orpc.report.gst.queryOptions({ input: { orgSlug, from, to } }));
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  const periodError = validateReportPeriod(draft.from, draft.to, 366);
  const money = (value: string) => formatReportMoney(value, membership.data.currency);

  const applyRange = () => {
    if (periodError) return;
    void navigate({ search: draft, replace: true });
  };

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
            patientMrn: row.patientMrn,
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
        title="GST outward register"
        description="Invoice and credit-note tax reporting"
      />
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
        <p className="text-muted-foreground">CGST/SGST split assumes intra-state supply.</p>

        {report.isPending ? null : report.isError ? (
          <ErrorNote
            title="Could not load the GST outward register"
            detail={report.error.message}
          />
        ) : (
          <section data-report-print className="space-y-4">
            <header className="border-b pb-2">
              <h1 className="text-sm font-semibold">GST outward register</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to} · CGST/SGST split assumes intra-state supply.
              </p>
            </header>

            <section className="space-y-2">
              <h2 className="font-semibold uppercase tracking-wide">Documents</h2>
              <div className="overflow-x-auto ring-1 ring-border">
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
                        <TableCell className="font-medium tabular-nums">{row.number}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{row.date}</TableCell>
                        <TableCell>{row.patientName}</TableCell>
                        <TableCell className="tabular-nums">{row.patientMrn}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.taxableValue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.cgst)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.sgst)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.taxAmount)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(row.gross)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={5}>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(report.data.totals.taxableValue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(report.data.totals.cgst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(report.data.totals.sgst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(report.data.totals.taxAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(report.data.totals.gross)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="space-y-2">
                <h2 className="font-semibold uppercase tracking-wide">Rate summary</h2>
                <div className="overflow-x-auto ring-1 ring-border">
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
                            {money(row.taxableValue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.cgst)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.sgst)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.taxAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.taxableValue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.cgst)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.sgst)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.taxAmount)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-semibold uppercase tracking-wide">HSN/SAC summary</h2>
                <div className="overflow-x-auto ring-1 ring-border">
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
                          <TableCell className="font-medium">{row.taxCode || "—"}</TableCell>
                          <TableCell className="tabular-nums">{row.taxRatePercent}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.taxableValue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.taxAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.taxableValue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(report.data.totals.taxAmount)}
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
