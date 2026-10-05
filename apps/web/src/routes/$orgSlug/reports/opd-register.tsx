import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appHead } from "@/config/site";
import { OpdAppointmentStatusBadge } from "@/components/opd-appointment";
import { DateFilter } from "@/components/list-filter";
import { ErrorNote, ListToolbar, LoadMore, PageBody, PageHeader } from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { saveXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { orgMonthToDate as defaultRange, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";
import { arrivalModeLabel, practitionerDisplayName } from "@hms/api/lib/labels";

const MAX_DAYS = 31;

type RegisterCursor = { businessDate: string; dayOrderAt: string; id: string };

const registerQuery = (orgSlug: string, range: { from: string; to: string }) =>
  orpc.report.opdRegister.infiniteOptions({
    input: (cursor: RegisterCursor | undefined) => ({ orgSlug, ...range, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/reports/opd-register")({
  head: () => appHead("OPD register"),
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
    await loadRouteQuery(queryClient.infiniteQuery(registerQuery(orgSlug, range)));

    return range;
  },
  component: OpdRegisterRoute,
});

function OpdRegisterRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const { today } = useOrgDateTime();

  // Reports always read a period, so clearing the preset falls back to the route default.
  const setRange = (range: { from?: string; to?: string }) =>
    navigate({ search: range, replace: true });

  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const report = useSuspenseInfiniteQuery(registerQuery(orgSlug, { from, to }));
  const totals = report.data.pages[0]?.totals;
  const rows = report.data.pages.flatMap((page) => page.rows);

  const download = useMutation({ ...orpc.export.opdRegisterXlsx.mutationOptions(), ...saveXlsx });

  return (
    <>
      <PageHeader
        title="OPD register"
        action={
          <ReportActions
            disabled={report.isFetching || download.isPending}
            onExport={() => download.mutate({ orgSlug, from, to })}
          />
        }
      />
      <PageBody>
        <div className="print:hidden">
          <ListToolbar>
            <DateFilter today={today} from={from} to={to} maxDays={MAX_DAYS} onChange={setRange} />
          </ListToolbar>
        </div>
        {report.isRefetchError ? (
          <ErrorNote title="Could not refresh the OPD register" error={report.error} />
        ) : null}
        <section data-report-print className="flex flex-col gap-4">
          <header className="border-b pb-2">
            <h1 className="text-sm font-medium">OPD register</h1>
            <p className="text-muted-foreground">
              {from} to {to} · Excel has every visit; print has the loaded rows.
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
                {rows.map((row) => (
                  <TableRow key={row.appointmentId}>
                    <TableCell className="whitespace-nowrap">{row.businessDate}</TableCell>
                    <TableCell className="font-mono">{row.tokenNumber ?? "—"}</TableCell>
                    <TableCell>
                      {row.patientName ? (
                        <div>
                          <p className="capitalize">{row.patientName}</p>
                          {row.patientMrn ? (
                            <p className="font-mono text-muted-foreground">{row.patientMrn}</p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground capitalize">
                          {row.callerName ?? "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="capitalize">
                      {practitionerDisplayName(row.practitionerName)}
                    </TableCell>
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
                    <TableCell className="text-right">{formatMoney(row.paid, currency)}</TableCell>
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
          <div className="print:hidden">
            <LoadMore query={report} shown={rows.length} />
          </div>

          {totals ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <dt className="text-muted-foreground">Appointments</dt>
                <dd className="font-medium tabular-nums">{totals.appointments}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Booked</dt>
                <dd className="font-medium tabular-nums">{totals.byStatus.booked}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Checked in</dt>
                <dd className="font-medium tabular-nums">{totals.byStatus.checked_in}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd className="font-medium tabular-nums">{totals.byStatus.cancelled}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">No show</dt>
                <dd className="font-medium tabular-nums">{totals.byStatus.no_show}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Billed</dt>
                <dd className="font-medium tabular-nums">{formatMoney(totals.billed, currency)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="font-medium tabular-nums">{formatMoney(totals.paid, currency)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credits</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(totals.credits, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Refunds</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(totals.refunds, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(totals.outstanding, currency)}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
