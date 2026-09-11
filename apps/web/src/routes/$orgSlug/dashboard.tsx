import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ClockIcon,
  ReceiptTextIcon,
  StethoscopeIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { BarChart, type BarDatum } from "@/components/bar-chart";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatDay } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { methodLabel } from "@/lib/settlement";

export const Route = createFileRoute("/$orgSlug/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const { roles } = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));

    const prefetches: Promise<unknown>[] = [];

    if (authorize(roles, { opd: ["read"] })) {
      prefetches.push(
        queryClient
          .query(orpc.dashboard.today.queryOptions({ input: { orgSlug } }))
          .catch(() => {}),
        queryClient
          .query(
            orpc.opd.day.queryOptions({
              input: { orgSlug, limit: 6 },
            }),
          )
          .catch(() => {}),
      );
    }

    if (authorize(roles, { billing: ["read"] })) {
      prefetches.push(
        queryClient
          .query(orpc.dashboard.collections.queryOptions({ input: { orgSlug } }))
          .catch(() => {}),
      );
    }

    await Promise.all(prefetches);
  },
  component: DashboardRoute,
});

type StatLink = "/$orgSlug/opd" | "/$orgSlug/files";

function StatCard({
  label,
  icon: Icon,
  value,
  note,
  trailing,
  pending,
  to,
  orgSlug,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  note: ReactNode;
  trailing?: ReactNode;
  pending?: boolean;
  to?: StatLink;
  orgSlug: string;
}) {
  const body = (
    <>
      <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="flex min-h-30 flex-1 flex-col justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          {pending ? null : (
            <span className="truncate text-3xl font-medium tracking-tight tabular-nums">
              {value}
            </span>
          )}
          {trailing}
        </div>
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="min-w-0 truncate">{note}</span>
          {to && <ArrowRightIcon className="size-3.5 shrink-0" />}
        </div>
      </div>
    </>
  );

  const shell = "flex flex-col rounded-xl bg-muted p-1";

  if (!to) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      to={to}
      params={{ orgSlug }}
      className={`${shell} [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/70`}
    >
      {body}
    </Link>
  );
}

function DashboardRoute() {
  const { orgSlug } = Route.useParams();
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const money = (value: bigint | undefined) =>
    value === undefined ? "—" : formatMoney(value, currency);

  // Each block asks for its own permission, so a role that may read appointments but
  // not money still gets the clinical half rather than an error page.
  const canReadOpdAppointments = authorize(roles, { opd: ["read"] });
  const canReadBilling = authorize(roles, { billing: ["read"] });

  const today = useQuery({
    ...orpc.dashboard.today.queryOptions({ input: { orgSlug } }),
    ...OPERATIONAL_REFETCH,
    enabled: canReadOpdAppointments,
  });

  const collections = useQuery({
    ...orpc.dashboard.collections.queryOptions({ input: { orgSlug } }),
    ...OPERATIONAL_REFETCH,
    enabled: canReadBilling,
  });

  const queue = useQuery({
    ...orpc.opd.day.queryOptions({
      input: { orgSlug, limit: 6 },
    }),
    ...OPERATIONAL_REFETCH,
    enabled: canReadOpdAppointments,
  });

  const mix = today.data?.mix ?? [];
  const mixTotal = mix.reduce((sum, row) => sum + row.count, 0);
  const trendAmounts = new Map<number, bigint>();

  const trend: BarDatum[] = (collections.data?.trend ?? []).map(({ day, amount }) => {
    const label = formatDay(day);
    // The chart geometry requires numbers; money stays bigint everywhere else.
    const value = Number(amount);
    trendAmounts.set(value, amount);

    return { label, value, caption: label };
  });

  return (
    <>
      <PageHeader title="Dashboard" />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canReadOpdAppointments && (
            <>
              <StatCard
                label="Booked, not arrived"
                icon={ClockIcon}
                value={today.data?.booked ?? 0}
                note="Expected today"
                pending={today.isPending}
                to="/$orgSlug/opd"
                orgSlug={orgSlug}
              />
              <StatCard
                label="Checked in"
                icon={StethoscopeIcon}
                value={today.data?.checkedIn ?? 0}
                note="Arrived today"
                pending={today.isPending}
                to="/$orgSlug/opd"
                orgSlug={orgSlug}
              />
            </>
          )}
          {canReadBilling && (
            <>
              <StatCard
                label="Unbilled"
                icon={ReceiptTextIcon}
                value={money(collections.data?.unbilled)}
                note="Unbilled past alert threshold"
                pending={collections.isPending}
                to="/$orgSlug/opd"
                orgSlug={orgSlug}
              />
              <StatCard
                label="Collected today"
                icon={WalletIcon}
                value={money(collections.data?.collected)}
                note={
                  collections.data?.byMethod.length
                    ? collections.data.byMethod
                        .map(({ method, amount }) => `${methodLabel(method)} ${money(amount)}`)
                        .join(" · ")
                    : "Nothing yet"
                }
                pending={collections.isPending}
                to="/$orgSlug/opd"
                orgSlug={orgSlug}
              />
            </>
          )}
        </div>

        {(canReadBilling || canReadOpdAppointments) && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {canReadBilling && (
              <Panel label="Collections, last 14 days" minHeight="min-h-44" padded>
                <ListState
                  query={collections}
                  errorTitle="Could not load collections"
                  isEmpty={false}
                  // The series is gap-filled in SQL, so the chart owns its own empty copy.
                  empty={null}
                >
                  <BarChart
                    data={trend}
                    formatValue={(value) => formatMoney(trendAmounts.get(value) ?? ZERO, currency)}
                    height={72}
                  />
                </ListState>
              </Panel>
            )}

            {canReadOpdAppointments && (
              <Panel label="Queue mix by department" minHeight="min-h-44" padded>
                <ListState
                  query={today}
                  errorTitle="Could not load today's counts"
                  isEmpty={mixTotal === 0}
                  empty="No appointments today."
                >
                  {mixTotal > 0 && (
                    <>
                      <div className="flex gap-1">
                        {mix.map((row, index) => (
                          <span
                            key={row.department}
                            className={`h-8 rounded-sm ${index === 0 ? "bg-foreground" : "bg-foreground/25"}`}
                            style={{ flexGrow: row.count }}
                            title={`${row.department}: ${row.count}`}
                          />
                        ))}
                      </div>
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {mix.map((row) => (
                          <div key={row.department} className="min-w-0">
                            <dt className="truncate text-muted-foreground">{row.department}</dt>
                            <dd className="font-medium tabular-nums">
                              {Math.round((row.count / mixTotal) * 100)}%
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  )}
                </ListState>
              </Panel>
            )}
          </div>
        )}

        {canReadOpdAppointments && (
          <Panel
            label="Waiting patients"
            minHeight="min-h-64"
            padded
            action={
              <div className="flex items-center gap-2">
                <Link
                  to="/$orgSlug/opd"
                  params={{ orgSlug }}
                  className="flex items-center gap-1 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
                >
                  Open queue
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </div>
            }
          >
            <ListState
              query={queue}
              errorTitle="Could not load the waiting queue"
              isEmpty={queue.data?.items.length === 0}
              empty="The queue is empty."
            >
              {queue.data && queue.data.items.length > 0 && (
                <table className="w-full text-left">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-normal">Token</th>
                      <th className="pb-2 font-normal">Patient</th>
                      <th className="pb-2 font-normal">Department</th>
                      <th className="pb-2 font-normal">Practitioner</th>
                      <th className="pb-2 text-right font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.data.items.map((appointment) => (
                      <tr key={appointment.id} className="border-t border-border">
                        <td className="py-2 font-mono tabular-nums text-muted-foreground">
                          {appointment.tokenNumber}
                        </td>
                        <td className="py-2">
                          <Link
                            to="/$orgSlug/opd/$appointmentId"
                            params={{ orgSlug, appointmentId: appointment.id }}
                            className="capitalize [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            {appointment.patientName}
                          </Link>
                        </td>
                        <td className="py-2 text-muted-foreground">{appointment.departmentName}</td>
                        <td className="py-2 text-muted-foreground capitalize">
                          {appointment.practitionerName}
                        </td>
                        <td className="py-2 text-right">
                          <Badge variant="secondary">
                            {appointment.status === "checked_in" ? "Checked In" : "Booked"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ListState>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
