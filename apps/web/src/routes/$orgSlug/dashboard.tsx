import { practitionerDisplayName } from "@hms/api/lib/labels";
import { authorize } from "@hms/auth/access";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type LinkOptions } from "@tanstack/react-router";
import { Button } from "@hms/ui/components/button";
import { SidebarTrigger } from "@hms/ui/components/sidebar";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { CollectionBars } from "@/components/collection-bars";
import { DateFilter } from "@/components/list-filter";
import { Monogram } from "@/components/monogram";
import { DataList, ErrorNote, PageBody, Panel, PanelEmpty } from "@/components/page";
import { dateRangeLabel } from "@/lib/date-presets";
import { useMembership } from "@/lib/membership";
import { formatMoney, percentOf, ZERO } from "@/lib/money";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { methodLabel } from "@/lib/settlement";

// One screen for owners and the desk alike, today unless a range is picked: what
// came in, and what is waiting on us. Each figure has a plain-language comparison or a next
// step, and every count opens its list (Few, NN/G: summaries with context).
type Range = { from?: string; to?: string };

const RANGES = [7, 14, 30] as const;

const collectionsQuery = (orgSlug: string, range: Range) =>
  orpc.dashboard.collections.queryOptions({ input: { orgSlug, ...range } });

// The billing desk owns the unbilled figure; the dashboard reads its summary.
const deskMoneyQuery = (orgSlug: string) =>
  orpc.billing.worklist.queryOptions({ input: { orgSlug, limit: 1 } });

// The chart's bars for one range ending on the period's last day; 7 days loads
// with the page and longer ranges only when picked.
const trendQuery = (orgSlug: string, to: string | undefined, days: (typeof RANGES)[number]) =>
  orpc.dashboard.trend.queryOptions({ input: { orgSlug, to, days } });

// Open visits (booked and arrived) in the range; a clinic day fits well inside the cap.
const visitsQuery = (orgSlug: string, range: Range) =>
  orpc.opd.day.queryOptions({ input: { orgSlug, ...range, limit: 200 } });

export const Route = createFileRoute("/$orgSlug/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Edernal Care" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const { roles } = await queryClient.query(orpc.member.me.queryOptions({ input: { orgSlug } }));
    const prefetches: Promise<unknown>[] = [];

    if (authorize(roles, { billing: ["read"] })) {
      prefetches.push(
        queryClient.query(collectionsQuery(orgSlug, deps)).catch(() => {}),
        queryClient.query(trendQuery(orgSlug, deps.to, 7)).catch(() => {}),
        queryClient.query(deskMoneyQuery(orgSlug)).catch(() => {}),
      );
    }

    if (authorize(roles, { opd: ["read"] })) {
      prefetches.push(queryClient.query(visitsQuery(orgSlug, deps)).catch(() => {}));
    }

    await Promise.all(prefetches);
  },
  component: DashboardRoute,
});

const hover = "[@media(hover:hover)_and_(pointer:fine)]:hover";

// One layer of container: a bordered card with its title inside, in ink.
function Card({
  title,
  action,
  children,
  tinted = false,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** The faint lime surface that marks the money card as the page's focus. */
  tinted?: boolean;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${
        tinted
          ? "border-brand-border bg-[color-mix(in_oklab,var(--brand-fill)_16%,var(--card))]"
          : "border-border bg-card"
      } ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

// The share tones, strongest first: lime for the largest part, then ink steps.
const TONES = ["bg-brand-fill", "bg-foreground/55", "bg-foreground/25", "bg-foreground/12"];

const tone = (index: number) => TONES[Math.min(index, TONES.length - 1)];

type Part = { key: string; label: string; value: string; weight: number; note?: string };

/** Parts of a whole as one stacked bar, then a two-column legend with shares. */
function Mix({ parts, link }: { parts: Part[]; link?: (part: Part) => LinkOptions }) {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);

  return (
    <div className="@container flex flex-col gap-4">
      <span className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {parts.map((part, index) => (
          <span key={part.key} className={tone(index)} style={{ flexGrow: part.weight }} />
        ))}
      </span>
      <ul className="grid gap-x-6 gap-y-2 @md:grid-cols-2">
        {parts.map((part, index) => {
          const body = (
            <>
              <span className={`size-2 shrink-0 rounded-full ${tone(index)}`} />
              <span className="min-w-0 flex-1 truncate">
                {part.label}
                {part.note && <span className="text-muted-foreground"> · {part.note}</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-muted-foreground">
                  {Math.round((part.weight / total) * 100)}% ·{" "}
                </span>
                <span className="font-medium">{part.value}</span>
              </span>
            </>
          );

          return (
            <li key={part.key}>
              {link ? (
                <Link
                  {...link(part)}
                  className={`flex items-center gap-2 ${hover}:[&>span:nth-child(2)]:underline`}
                >
                  {body}
                </Link>
              ) : (
                <span className="flex items-center gap-2">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const SOURCE_LABELS = { opd: "OPD", pharmacy: "Pharmacy", advance: "Advances" } as const;

// Earliest first: arrival time for those checked in, booked time for the rest.
const byTime = (a: { dayOrderAt: Date | null }, b: { dayOrderAt: Date | null }) =>
  (a.dayOrderAt?.getTime() ?? 0) - (b.dayOrderAt?.getTime() ?? 0);

const minutesSince = (since: Date, now: number) =>
  Math.max(0, Math.floor((now - since.getTime()) / 60_000));

const formatWait = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;

const weekdayName = (day: string) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** The clinic's hour, not the browser's, so server and client agree. */
function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      new Date(),
    ),
  );

  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const longDayFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const longDay = (day: string) => longDayFormat.format(new Date(`${day}T00:00:00Z`));

function DashboardRoute() {
  const { orgSlug } = Route.useParams();
  const { today, timeZone } = useOrgDateTime();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useSearch();
  const isToday = from === undefined && to === undefined;
  const rangeLabel = dateRangeLabel(today, from, to, "Today");
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const userName = useMembership(orgSlug, (membership) => membership.user.name);
  const canReadBilling = authorize(roles, { billing: ["read"] });
  const canReadOpd = authorize(roles, { opd: ["read"] });
  const canReadReport = authorize(roles, { report: ["readDailyCollections"] });
  const money = (value: bigint) => formatMoney(value, currency);
  const [range, setRange] = useState<(typeof RANGES)[number]>(7);

  const trend = useQuery({
    ...trendQuery(orgSlug, to, range),
    ...OPERATIONAL_REFETCH,
    // The previous range stays on screen while a longer one loads.
    placeholderData: keepPreviousData,
    enabled: canReadBilling,
  });

  const collections = useQuery({
    ...collectionsQuery(orgSlug, { from, to }),
    ...OPERATIONAL_REFETCH,
    enabled: canReadBilling,
  });

  const desk = useQuery({
    ...deskMoneyQuery(orgSlug),
    ...OPERATIONAL_REFETCH,
    enabled: canReadBilling,
  });

  const visits = useQuery({
    ...visitsQuery(orgSlug, { from, to }),
    ...OPERATIONAL_REFETCH,
    enabled: canReadOpd,
  });

  const data = collections.data;
  const usualDay = data?.usual?.amount ?? ZERO;

  const usualLabel = data?.usual?.sameWeekday ? `a usual ${weekdayName(today)}` : "a usual day";

  const comparison = (() => {
    if (!data) return null;

    // A usual day only compares a single day in progress; the label names the range.
    if (!isToday) return null;

    if (data.collected <= ZERO) return "No payments yet today.";

    if (usualDay <= ZERO) return "Collected so far today";

    const difference = data.collected - usualDay;
    // Within 5% of usual reads as "about the same": smaller swings are noise.
    const close = percentOf(difference < ZERO ? -difference : difference, usualDay) < 5;

    if (close) return `About the same as ${usualLabel}`;

    return difference > ZERO
      ? `${money(difference)} more than ${usualLabel}`
      : `${money(-difference)} less than ${usualLabel} so far`;
  })();

  const methods = (data?.byMethod ?? []).filter((row) => row.amount > ZERO);
  const open = visits.data?.items ?? [];
  const capped = Boolean(visits.data?.nextCursor);
  const arrived = open.filter((visit) => visit.status === "checked_in").toSorted(byTime);
  const booked = open.filter((visit) => visit.status === "booked").toSorted(byTime);
  const nextBooked = booked[0];
  const summary = desk.data?.summary;

  // Per department: who has arrived and who is still to come.
  const byDepartment = new Map<string, { arrived: number; booked: number }>();

  for (const visit of open) {
    const name = visit.departmentName ?? "Unassigned";
    const row = byDepartment.get(name) ?? { arrived: 0, booked: 0 };

    if (visit.status === "checked_in") row.arrived += 1;
    else row.booked += 1;

    byDepartment.set(name, row);
  }

  const departments = [...byDepartment.entries()]
    .filter(([, row]) => row.arrived > 0)
    .toSorted((a, b) => b[1].arrived - a[1].arrived);

  // Money by area, after refunds; each source is a row so IPD and lab slot in.
  const sources = (data?.bySource ?? []).filter((row) => row.amount > ZERO);

  const now = Date.now();

  const opd = { to: "/$orgSlug/opd", params: { orgSlug } } as const;

  const figures: { label: string; value: string; note: string; link: LinkOptions }[] = [
    ...(canReadOpd
      ? [
          {
            label: "Booked, not arrived",
            value: visits.data ? String(booked.length) : "",
            note: nextBooked?.dayOrderAt
              ? `Next expected at ${formatTime(nextBooked.dayOrderAt, timeZone)}`
              : nextBooked
                ? "No time set for the next booking"
                : isToday
                  ? "Nobody else is booked today"
                  : `Nobody booked · ${rangeLabel}`,
            link: opd,
          },
          {
            label: "Checked in",
            value: visits.data ? `${arrived.length}${capped ? "+" : ""}` : "",
            note: !isToday
              ? rangeLabel
              : arrived[0]?.dayOrderAt
                ? `Longest wait ${formatWait(minutesSince(arrived[0].dayOrderAt, now))}`
                : "Arrived and not yet seen",
            link: opd,
          },
        ]
      : []),
    ...(canReadBilling
      ? [
          {
            label: "Unbilled",
            value: summary ? money(summary.toBillTotal) : "",
            note:
              summary && summary.toBillCount > 0
                ? `${summary.toBillCount} ${summary.toBillCount === 1 ? "visit" : "visits"} · bill before they leave`
                : "Every visit is billed",
            link: {
              to: "/$orgSlug/billing",
              params: { orgSlug },
              search: { view: "to-bill" },
            } as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageBody width="max-w-[1280px]">
        {collections.isLoadingError && (
          <ErrorNote title="Could not load collections" error={collections.error} />
        )}

        {/* No page header: the greeting names the page, the range sits beside it. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="lg:hidden" />
            <div className="flex flex-col">
              <h1 className="text-lg font-medium">
                {greeting(timeZone)}
                {userName && `, ${userName.split(" ")[0]}`}
              </h1>
              <p className="text-muted-foreground">{longDay(today)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DateFilter
              today={today}
              from={from ?? today}
              to={to ?? today}
              onChange={(range) =>
                void navigate({
                  replace: true,
                  search:
                    range.from === today && range.to === today
                      ? { from: undefined, to: undefined }
                      : range,
                })
              }
            />
            {canReadReport && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Open the daily collections report"
                title="Daily collections report"
                nativeButton={false}
                render={
                  <Link
                    to="/$orgSlug/reports/daily-collections"
                    params={{ orgSlug }}
                    search={{ from: from ?? today, to: to ?? today }}
                  />
                }
              >
                <FileTextIcon />
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          {canReadBilling && (
            <Card tinted title={isToday ? "Collected today" : `Collected · ${rangeLabel}`}>
              <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex flex-col gap-1">
                  <span className="min-h-9 text-3xl font-medium tracking-tight tabular-nums">
                    {data && money(data.collected)}
                  </span>
                  <span
                    className={
                      data && usualDay > ZERO && data.collected > usualDay
                        ? "text-brand"
                        : "text-muted-foreground"
                    }
                  >
                    {comparison}
                  </span>
                </div>
                {methods.length > 0 && (
                  <div className="flex flex-col justify-end gap-2 sm:border-l sm:border-border sm:pl-4">
                    <span className="text-muted-foreground">
                      {isToday ? "How today was paid" : "How it was paid"}
                    </span>
                    <span className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                      {methods.map((row, index) => (
                        <span
                          key={row.method}
                          className={
                            index === 0
                              ? "bg-brand-fill"
                              : index === 1
                                ? "bg-foreground/55"
                                : "bg-foreground/20"
                          }
                          style={{ flexGrow: Number(row.amount) }}
                        />
                      ))}
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      {methods.map((row) => (
                        <span key={row.method}>
                          <span className="text-muted-foreground">{methodLabel(row.method)} </span>
                          {money(row.amount)}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>

              <CollectionBars
                trend={trend.data ?? []}
                range={range}
                today={today}
                showTotal={isToday}
                money={money}
                action={
                  <div
                    role="group"
                    aria-label="Days shown"
                    className="flex gap-1 rounded-lg bg-muted p-1"
                  >
                    {RANGES.map((days) => (
                      <button
                        key={days}
                        type="button"
                        aria-pressed={range === days}
                        onClick={() => setRange(days)}
                        className="h-6 rounded-md px-2.5 text-muted-foreground tabular-nums aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
                      >
                        {days} days
                      </button>
                    ))}
                  </div>
                }
              />
            </Card>
          )}

          {figures.length > 0 && (
            <section className="grid divide-border overflow-hidden rounded-xl border border-border bg-card max-sm:divide-y sm:grid-cols-3 sm:max-xl:divide-x xl:grid-cols-1 xl:divide-y">
              {figures.map((figure) => (
                <Link
                  key={figure.label}
                  {...figure.link}
                  className={`group flex flex-col justify-center gap-1 p-4 text-left ${hover}:bg-muted/40`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    {figure.label}
                    <ArrowUpRightIcon className="size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                  </span>
                  <span className="min-h-8 text-2xl font-medium tracking-tight tabular-nums">
                    {figure.value}
                  </span>
                  <span className="text-muted-foreground">{figure.note}</span>
                </Link>
              ))}
            </section>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {canReadBilling && (
            <Card
              title="Collected by area"
              className="min-h-40"
              action={<span className="text-muted-foreground">After refunds</span>}
            >
              {sources.length === 0 ? (
                <p className="flex flex-1 items-center justify-center pb-8 text-center text-muted-foreground">
                  {isToday ? "Nothing collected yet today" : "Nothing collected in this period"}
                </p>
              ) : (
                <Mix
                  parts={sources.map((row) => ({
                    key: row.source,
                    label: SOURCE_LABELS[row.source],
                    value: money(row.amount),
                    weight: Number(row.amount),
                  }))}
                  link={(part) =>
                    part.key === "pharmacy"
                      ? { to: "/$orgSlug/pharmacy", params: { orgSlug } }
                      : part.key === "advance"
                        ? { to: "/$orgSlug/billing/advances", params: { orgSlug } }
                        : { to: "/$orgSlug/billing", params: { orgSlug } }
                  }
                />
              )}
            </Card>
          )}

          {canReadOpd && (
            <Card title="Queue mix" className="min-h-40">
              {departments.length === 0 ? (
                <p className="flex flex-1 items-center justify-center pb-8 text-center text-muted-foreground">
                  {isToday
                    ? "No patients have checked in yet today"
                    : "No open visits in this period"}
                </p>
              ) : (
                <Mix
                  parts={departments.map(([name, row]) => ({
                    key: name,
                    label: name,
                    value: String(row.arrived),
                    weight: row.arrived,
                    note: row.booked > 0 ? `${row.booked} booked` : undefined,
                  }))}
                />
              )}
            </Card>
          )}
        </div>

        {canReadOpd && isToday && (
          <Panel
            // The dashboard's section titles share one size, weight and ink.
            label={<span className="text-sm font-medium text-foreground">Waiting now</span>}
            minHeight="min-h-48"
            action={
              <Button variant="ghost" size="xs" nativeButton={false} render={<Link {...opd} />}>
                Open queue <ArrowUpRightIcon />
              </Button>
            }
          >
            {arrived.length === 0 ? (
              <PanelEmpty>Nobody is waiting right now</PanelEmpty>
            ) : (
              <DataList
                rows={arrived}
                rowKey={(visit) => visit.id}
                link={(visit) => ({
                  to: "/$orgSlug/opd/$appointmentId",
                  params: { orgSlug, appointmentId: visit.id },
                })}
                columns={[
                  {
                    head: "Patient",
                    cell: (visit) => {
                      const name = visit.patientName ?? visit.callerName ?? "Unnamed caller";

                      return (
                        <span className="flex items-center gap-3">
                          <Monogram
                            label={name}
                            seed={visit.patientMrn ?? visit.id}
                            kind="patient"
                          />
                          <span className="font-medium">{name}</span>
                        </span>
                      );
                    },
                  },
                  {
                    head: "Token",
                    className: "w-20",
                    cell: (visit) => (
                      <span className="font-mono tabular-nums">{visit.tokenNumber ?? "–"}</span>
                    ),
                  },
                  {
                    head: "Department",
                    cell: (visit) => visit.departmentName ?? "No department",
                  },
                  {
                    head: "Practitioner",
                    cell: (visit) => practitionerDisplayName(visit.practitionerName),
                  },
                  {
                    head: "Waiting",
                    className: "w-24 text-right",
                    mobile: "title",
                    cell: (visit) => {
                      if (!visit.dayOrderAt) return null;

                      const minutes = minutesSince(visit.dayOrderAt, now);

                      return (
                        <span
                          className={`tabular-nums ${minutes >= 30 ? "text-overdue" : "text-muted-foreground"}`}
                        >
                          {formatWait(minutes)}
                        </span>
                      );
                    },
                  },
                ]}
              />
            )}
          </Panel>
        )}
      </PageBody>
    </>
  );
}
