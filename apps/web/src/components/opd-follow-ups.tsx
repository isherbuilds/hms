import type { AppRouter } from "@hms/api/routers/index";
import { buttonVariants } from "@hms/ui/components/button";
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
    <Panel
      label="Follow-ups"
      minHeight="min-h-64"
      grow
      footer={<LoadMore query={followUps} shown={rows.length} />}
    >
      <ListState
        query={followUps}
        errorTitle="Could not load follow-ups"
        isEmpty={rows.length === 0}
        empty="No treatment plans need a follow-up."
      >
        <>
          <div className="hidden flex-col divide-y md:flex">
            {rows.map((row) => (
              <FollowUpDesktopRow
                key={row.id}
                row={row}
                orgSlug={orgSlug}
                currency={currency}
                canBook={canBook}
              />
            ))}
          </div>
          <ul role="list" className="md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="border-b px-3 py-2 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/$orgSlug/patients/$patientId"
                      params={{ orgSlug, patientId: row.patientId }}
                      search={{ tab: "treatment" }}
                      className="block truncate font-medium capitalize"
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
                        "shrink-0",
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
    <article className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-52 flex-1">
        <Link
          to="/$orgSlug/patients/$patientId"
          params={{ orgSlug, patientId: row.patientId }}
          search={{ tab: "treatment" }}
          className="font-medium capitalize underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
        >
          {row.patientName}
        </Link>
        <p className="text-muted-foreground">
          {row.patientMrn} · {row.patientPhone}
        </p>
      </div>
      <div className="min-w-52 flex-1">
        <p className="font-medium">{row.label}</p>
        <p className="text-muted-foreground">
          <span className="capitalize">{practitionerDisplayName(row.practitionerName)}</span> ·{" "}
          {row.sittingsDone} {row.sittingsDone === 1 ? "sitting" : "sittings"}
          {lastSittingLabel(row.lastSittingOn)}
        </p>
      </div>
      <div className="min-w-44">
        <p>{row.nextSittingOn ? formatBusinessDate(row.nextSittingOn) : "Date not set"}</p>
        <p className="max-w-64 truncate text-muted-foreground">
          {row.nextSittingNote ?? "No follow-up note"}
        </p>
      </div>
      <p className="min-w-28 text-right tabular-nums text-muted-foreground">
        Credit {formatMoney(row.creditHeld, currency)}
      </p>
      {canBook ? (
        <Link
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "shrink-0")}
          to="/$orgSlug/opd/new"
          params={{ orgSlug }}
          search={{ patientId: row.patientId, treatmentPlanId: row.id }}
        >
          <CalendarPlusIcon />
          Book sitting
        </Link>
      ) : null}
    </article>
  );
}
