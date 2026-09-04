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

import { OPD_STATUS_LABELS, OpdAppointmentStatusBadge } from "@/components/opd-appointment";
import { ReportPeriodControls } from "@/components/report-period-controls";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { formatDateTime, orgMonthToDate as defaultRange, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

const MAX_DAYS = 31;

function arrivalModeLabel(mode: "scheduled" | "walk_in"): string {
  return mode === "walk_in" ? "Walk-in" : "Scheduled";
}

export const Route = createFileRoute("/$orgSlug/reports/opd-register")({
  head: () => ({ meta: [{ title: "OPD register · HMS" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readOpdRegister"] },
      "/$orgSlug/dashboard",
    );
    const fallback = defaultRange(timeZone);
    const range = { from: deps.from ?? fallback.from, to: deps.to ?? fallback.to };
    await loadRouteQuery(
      queryClient.query(orpc.report.opdRegister.queryOptions({ input: { orgSlug, ...range } })),
    );
    return range;
  },
  component: OpdRegisterRoute,
});

function OpdRegisterRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const { timeZone } = useOrgDateTime();
  const report = useQuery(orpc.report.opdRegister.queryOptions({ input: { orgSlug, from, to } }));

  const exportReport = () => {
    if (!report.data) return;
    void downloadXlsx(`opd-register-${from}-to-${to}.xlsx`, [
      {
        name: "OPD register",
        columns: [
          { header: "Appointment ID", key: "appointmentId", width: 38 },
          { header: "Business date", key: "businessDate", width: 16 },
          { header: "Token", key: "tokenNumber", width: 10 },
          { header: "Patient", key: "patientName", width: 28 },
          { header: "MRN", key: "patientMrn", width: 16 },
          { header: "Caller", key: "callerName", width: 28 },
          { header: "Practitioner", key: "practitionerName", width: 24 },
          { header: "Department", key: "departmentName", width: 22 },
          { header: "Mode", key: "arrivalMode", width: 14 },
          { header: "Status", key: "status", width: 14 },
          { header: "Arrived at", key: "arrivedAt", width: 24 },
          { header: "Billed", key: "billed", width: 16 },
          { header: "Paid", key: "paid", width: 16 },
          { header: "Credits", key: "credits", width: 16 },
          { header: "Refunds", key: "refunds", width: 16 },
          { header: "Outstanding", key: "outstanding", width: 16 },
        ],
        rows: report.data.rows.map((row) => ({
          appointmentId: row.appointmentId,
          businessDate: row.businessDate,
          tokenNumber: row.tokenNumber ?? "",
          patientName: row.patientName ?? "",
          patientMrn: row.patientMrn ?? "",
          callerName: row.callerName ?? "",
          practitionerName: row.practitionerName,
          departmentName: row.departmentName,
          arrivalMode: arrivalModeLabel(row.arrivalMode),
          status: OPD_STATUS_LABELS[row.status],
          arrivedAt: row.arrivedAt ? formatDateTime(row.arrivedAt, timeZone) : "",
          billed: Number(row.billed),
          paid: Number(row.paid),
          credits: Number(row.credits),
          refunds: Number(row.refunds),
          outstanding: Number(row.outstanding),
        })),
      },
      {
        name: "Summary",
        columns: [
          { header: "Metric", key: "metric", width: 20 },
          { header: "Value", key: "value", width: 16 },
        ],
        rows: [
          { metric: "Currency", value: currency },
          { metric: "Appointments", value: report.data.totals.appointments },
          { metric: "Booked", value: report.data.totals.byStatus.booked },
          { metric: "Checked in", value: report.data.totals.byStatus.checked_in },
          { metric: "Cancelled", value: report.data.totals.byStatus.cancelled },
          { metric: "No show", value: report.data.totals.byStatus.no_show },
          { metric: "Billed", value: Number(report.data.totals.billed) },
          { metric: "Paid", value: Number(report.data.totals.paid) },
          { metric: "Credits", value: Number(report.data.totals.credits) },
          { metric: "Refunds", value: Number(report.data.totals.refunds) },
          { metric: "Outstanding", value: Number(report.data.totals.outstanding) },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="OPD register"
        description="One row per appointment with attendance and money"
      />
      <PageBody>
        <ReportPeriodControls
          key={`${orgSlug}:${from}:${to}`}
          from={from}
          to={to}
          maxDays={MAX_DAYS}
          onApply={(range) => void navigate({ search: range, replace: true })}
        >
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
        </ReportPeriodControls>

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the OPD register" error={report.error} />
        ) : (
          <section data-report-print className="space-y-4">
            <header className="border-b pb-2">
              <h1 className="text-sm font-medium">OPD register</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to}
              </p>
            </header>

            <div className="ring-1 ring-border">
              <Table className="min-w-6xl print:min-w-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Practitioner</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.rows.map((row) => (
                    <TableRow key={row.appointmentId}>
                      <TableCell className="whitespace-nowrap">{row.businessDate}</TableCell>
                      <TableCell className="font-mono">{row.tokenNumber ?? "—"}</TableCell>
                      <TableCell>
                        {row.patientName ? (
                          <div>
                            <p>{row.patientName}</p>
                            {row.patientMrn ? (
                              <p className="font-mono text-muted-foreground">{row.patientMrn}</p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{row.callerName ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell>{row.practitionerName}</TableCell>
                      <TableCell>{row.departmentName}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {arrivalModeLabel(row.arrivalMode)}
                      </TableCell>
                      <TableCell>
                        <OpdAppointmentStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(row.billed, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(row.paid, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(row.credits, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(row.refunds, currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(row.outstanding, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <dt className="text-muted-foreground">Appointments</dt>
                <dd className="font-medium tabular-nums">{report.data.totals.appointments}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Booked</dt>
                <dd className="font-medium tabular-nums">{report.data.totals.byStatus.booked}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Checked in</dt>
                <dd className="font-medium tabular-nums">
                  {report.data.totals.byStatus.checked_in}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd className="font-medium tabular-nums">
                  {report.data.totals.byStatus.cancelled}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">No show</dt>
                <dd className="font-medium tabular-nums">{report.data.totals.byStatus.no_show}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Billed</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(report.data.totals.billed, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(report.data.totals.paid, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credits</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(report.data.totals.credits, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Refunds</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(report.data.totals.refunds, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(report.data.totals.outstanding, currency)}
                </dd>
              </div>
            </dl>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
