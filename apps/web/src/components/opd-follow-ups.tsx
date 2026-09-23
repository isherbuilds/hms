import type { AppRouter } from "@hms/api/routers/index";
import { buttonVariants } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { cn } from "@hms/ui/lib/utils";
import type { RouterClient } from "@orpc/server";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarPlusIcon } from "lucide-react";

import { ListState, LoadMore, Panel } from "@/components/page";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

type FollowUpCursor = {
  nextSittingOn: string | null;
  lastSittingOn: string | null;
  id: string;
};

type FollowUpRow = Awaited<
  ReturnType<RouterClient<AppRouter>["treatment"]["followUps"]>
>["items"][number];

export const followUpsQuery = (orgSlug: string, query: string) =>
  orpc.treatment.followUps.infiniteOptions({
    input: (cursor: FollowUpCursor | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 25,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Typing keeps the call sheet on screen; a blank list between keystrokes reads as
    // "nobody to call".
    placeholderData: keepPreviousData,
  });

function lastSittingLabel(lastSittingOn: string | null) {
  return lastSittingOn ? ` · last ${formatBusinessDate(lastSittingOn)}` : " · no sitting yet";
}

/** The desk's call sheet: open plans with no booked sitting, due first. */
export function OpdFollowUps({ orgSlug, search }: { orgSlug: string; search: string }) {
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // Booking the sitting is the point of the list; a reader without the grant still calls.
  const canBook = useCan(orgSlug, { opd: ["create"] });
  const followUps = useInfiniteQuery(followUpsQuery(orgSlug, search));
  const rows = followUps.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel minHeight="min-h-64" grow footer={<LoadMore query={followUps} shown={rows.length} />}>
      <ListState
        query={followUps}
        errorTitle="Could not load follow-ups"
        isEmpty={rows.length === 0}
        empty="No treatment plans need a follow-up."
      >
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Next sitting</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  {canBook ? <TableHead className="w-28" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <FollowUpDesktopRow
                    key={row.id}
                    row={row}
                    orgSlug={orgSlug}
                    currency={currency}
                    canBook={canBook}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <ul role="list" className="md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="relative border-b px-3 py-2 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/$orgSlug/patients/$patientId"
                      params={{ orgSlug, patientId: row.patientId }}
                      search={{ tab: "treatment" }}
                      className="block truncate font-medium capitalize after:absolute after:inset-0"
                    >
                      {row.patientName}
                    </Link>
                    <p className="truncate font-mono text-muted-foreground">
                      {row.patientMrn} · {row.patientPhone}
                    </p>
                  </div>
                  {canBook ? (
                    <Link
                      aria-label={`Book a sitting for ${row.patientName}`}
                      className={cn(
                        buttonVariants({ size: "icon-xs", variant: "ghost" }),
                        "relative shrink-0",
                      )}
                      to="/$orgSlug/opd/new"
                      params={{ orgSlug }}
                      search={{ patientId: row.patientId, treatmentPlanId: row.id }}
                    >
                      <CalendarPlusIcon />
                    </Link>
                  ) : null}
                </div>
                <p className="truncate">{row.label}</p>
                <p className="flex justify-between gap-2 text-muted-foreground">
                  <span className="truncate">
                    {row.nextSittingOn
                      ? `Next ${formatBusinessDate(row.nextSittingOn)}`
                      : "Date not set"}
                    {lastSittingLabel(row.lastSittingOn)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    Credit {formatMoney(row.creditHeld, currency)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      </ListState>
    </Panel>
  );
}

function FollowUpDesktopRow({
  row,
  orgSlug,
  currency,
  canBook,
}: {
  row: FollowUpRow;
  orgSlug: string;
  currency: string;
  canBook: boolean;
}) {
  return (
    <TableRow className="relative">
      <TableCell className="max-w-0">
        <Link
          to="/$orgSlug/patients/$patientId"
          params={{ orgSlug, patientId: row.patientId }}
          search={{ tab: "treatment" }}
          title={row.patientName}
          className="block truncate font-medium capitalize underline-offset-4 after:absolute after:inset-0 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
        >
          {row.patientName}
        </Link>
        <p className="truncate font-mono text-muted-foreground">
          {row.patientMrn} · {row.patientPhone}
        </p>
      </TableCell>
      <TableCell className="max-w-0">
        <p className="truncate font-medium" title={row.label}>
          {row.label}
        </p>
        <p className="truncate text-muted-foreground">
          <span className="capitalize">{practitionerDisplayName(row.practitionerName)}</span> ·{" "}
          {row.sittingsDone} {row.sittingsDone === 1 ? "sitting" : "sittings"}
          {lastSittingLabel(row.lastSittingOn)}
        </p>
      </TableCell>
      <TableCell className="max-w-0">
        <p className="whitespace-nowrap">
          {row.nextSittingOn ? formatBusinessDate(row.nextSittingOn) : "Date not set"}
        </p>
        <p className="truncate text-muted-foreground" title={row.nextSittingNote ?? undefined}>
          {row.nextSittingNote ?? "No follow-up note"}
        </p>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap text-muted-foreground">
        {formatMoney(row.creditHeld, currency)}
      </TableCell>
      {canBook ? (
        <TableCell className="text-right">
          <Link
            className={cn(buttonVariants({ size: "xs", variant: "outline" }), "relative")}
            to="/$orgSlug/opd/new"
            params={{ orgSlug }}
            search={{ patientId: row.patientId, treatmentPlanId: row.id }}
          >
            <CalendarPlusIcon data-icon="inline-start" />
            Book sitting
          </Link>
        </TableCell>
      ) : null}
    </TableRow>
  );
}
