import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Skeleton } from "@hms/ui/components/skeleton";
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
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/dashboard")({
  // Fire-and-forget: starts the fetches on link hover (`defaultPreload:
  // "intent"`) without blocking navigation on them.
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchQuery(orpc.dashboard.today.queryOptions({ input: { orgSlug } }));
  },
  component: DashboardRoute,
});

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const dayLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

/** Amounts arrive as `numeric` strings so they never round through a float. */
function formatMoney(value: string | number | undefined): string {
  if (value === undefined) return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? money.format(amount) : "—";
}

type StatLink = "/org/$orgSlug/front-desk/queue" | "/org/$orgSlug/billing" | "/org/$orgSlug/files";

/**
 * The card the dashboard is built from, and the reason the grid reads as one
 * instrument: a tinted shell carrying the label, a raised surface carrying the
 * number. `text-2xl` is the deliberate exception to the app's `text-xs` body —
 * on these cards the number *is* the content, not a detail inside it.
 */
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
      <div className="flex min-h-24 flex-1 flex-col justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          {pending ? (
            <Skeleton className="h-9 w-24" />
          ) : (
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

/** The same shell, for content that is not a single number. */
function Panel({
  label,
  action,
  minHeight = "min-h-44",
  children,
}: {
  label: string;
  action?: ReactNode;
  /** Panels keep their height when empty: an empty dashboard should read as a
   *  dashboard with nothing in it, not as a collapsed page. */
  minHeight?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl bg-muted p-1">
      <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        {action}
      </div>
      <div
        className={`flex flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-4 ${minHeight}`}
      >
        {children}
      </div>
    </section>
  );
}

function DashboardRoute() {
  const { orgSlug } = Route.useParams();
  const membership = useQuery(orpc.members.me.queryOptions({ input: { orgSlug } }));
  const roles = membership.data?.roles;

  // Each block asks for its own permission, so a role that may read visits but
  // not money still gets the clinical half rather than an error page.
  const canReadVisits = roles ? authorize(roles, { visit: ["read"] }) : false;
  const canReadBilling = roles ? authorize(roles, { billing: ["read"] }) : false;

  const today = useQuery({
    ...orpc.dashboard.today.queryOptions({ input: { orgSlug } }),
    enabled: canReadVisits,
  });
  const collections = useQuery({
    ...orpc.dashboard.collections.queryOptions({ input: { orgSlug } }),
    enabled: canReadBilling,
  });
  const queue = useQuery({
    ...orpc.visit.queue.queryOptions({ input: { orgSlug, statuses: ["waiting", "in_consult"] } }),
    enabled: canReadVisits,
  });

  const mix = today.data?.mix ?? [];
  const mixTotal = mix.reduce((sum, row) => sum + row.count, 0);
  const trend: BarDatum[] = (collections.data?.trend ?? []).map(({ day, amount }) => ({
    label: dayLabel.format(new Date(`${day}T00:00:00Z`)),
    value: Number(amount),
    caption: dayLabel.format(new Date(`${day}T00:00:00Z`)),
  }));

  return (
    <>
      <PageHeader title="Dashboard" description="Today at a glance" />

      <PageBody>
        {today.isError && (
          <ErrorNote title="Could not load today's queue" detail={today.error.message} />
        )}
        {collections.isError && (
          <ErrorNote title="Could not load collections" detail={collections.error.message} />
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canReadVisits && (
            <>
              <StatCard
                label="Waiting now"
                icon={ClockIcon}
                value={today.data?.waiting ?? 0}
                note={
                  today.data?.longestWaitMin
                    ? `Longest wait ${today.data.longestWaitMin} min`
                    : "Nobody is waiting"
                }
                pending={today.isPending}
                to="/org/$orgSlug/front-desk/queue"
                orgSlug={orgSlug}
              />
              <StatCard
                label="In consult"
                icon={StethoscopeIcon}
                value={today.data?.inConsult ?? 0}
                note={`${today.data?.completed ?? 0} completed today`}
                pending={today.isPending}
                to="/org/$orgSlug/front-desk/queue"
                orgSlug={orgSlug}
              />
            </>
          )}
          {canReadBilling && (
            <>
              <StatCard
                label="Unbilled"
                icon={ReceiptTextIcon}
                value={formatMoney(collections.data?.unbilled)}
                note={`${collections.data?.unbilledVisits ?? 0} visits with pending charges`}
                pending={collections.isPending}
                to="/org/$orgSlug/billing"
                orgSlug={orgSlug}
              />
              <StatCard
                label="Collected today"
                icon={WalletIcon}
                value={formatMoney(collections.data?.collected)}
                note={`Cash ${formatMoney(collections.data?.cash)} · UPI ${formatMoney(collections.data?.upi)}`}
                pending={collections.isPending}
                to="/org/$orgSlug/billing"
                orgSlug={orgSlug}
              />
            </>
          )}
        </div>

        {(canReadBilling || canReadVisits) && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {canReadBilling && (
              <Panel label="Collections, last 14 days">
                {collections.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <BarChart data={trend} formatValue={(value) => formatMoney(value)} height={72} />
                )}
              </Panel>
            )}

            {canReadVisits && (
              <Panel label="Queue mix by department">
                {today.isPending && <Skeleton className="h-32 w-full" />}
                {!today.isPending && mixTotal === 0 && (
                  <p className="m-auto text-muted-foreground">No visits registered today yet.</p>
                )}
                {mixTotal > 0 && (
                  <>
                    <div className="flex gap-0.5">
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
              </Panel>
            )}
          </div>
        )}

        {canReadVisits && (
          <Panel
            label="Waiting patients"
            minHeight="min-h-64"
            action={
              <Link
                to="/org/$orgSlug/front-desk/queue"
                params={{ orgSlug }}
                className="flex items-center gap-1 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
              >
                Open queue
                <ArrowRightIcon className="size-3.5" />
              </Link>
            }
          >
            {queue.isPending && <Skeleton className="h-16 w-full" />}
            {queue.data?.length === 0 && (
              <p className="m-auto text-muted-foreground">The queue is empty.</p>
            )}
            {queue.data && queue.data.length > 0 && (
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
                  {queue.data.slice(0, 6).map((visit) => (
                    <tr key={visit.id} className="border-t border-border">
                      <td className="py-2 font-mono tabular-nums text-muted-foreground">
                        {visit.tokenNumber}
                      </td>
                      <td className="py-2">
                        <Link
                          to="/org/$orgSlug/front-desk/visits/$visitId"
                          params={{ orgSlug, visitId: visit.id }}
                          className="[@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {visit.patientName}
                        </Link>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {visit.departmentName ?? "Unassigned"}
                      </td>
                      <td className="py-2 text-muted-foreground">{visit.practitionerName}</td>
                      <td className="py-2 text-right">
                        <Badge variant={visit.status === "in_consult" ? "default" : "secondary"}>
                          {visit.status === "in_consult" ? "In consult" : "Waiting"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
      </PageBody>
    </>
  );
}
