import { buttonVariants } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarPlusIcon } from "lucide-react";

import { DataList, ListState, LoadMore, Panel } from "@/components/page";
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
    <Panel grow footer={<LoadMore query={followUps} shown={rows.length} />}>
      <ListState
        query={followUps}
        errorTitle="Could not load follow-ups"
        isEmpty={rows.length === 0}
        empty="No follow-ups due"
      >
        <DataList
          columns={[
            {
              head: "Patient",
              cell: (row) => <span className="capitalize">{row.patientName}</span>,
            },
            {
              head: "MRN / phone",
              cell: (row) => (
                <span className="font-mono text-muted-foreground">
                  {row.patientMrn} · {row.patientPhone}
                </span>
              ),
              mobile: "title",
            },
            {
              head: "Plan",
              cell: (row) => (
                <span className="font-medium" title={row.label}>
                  {row.label}
                </span>
              ),
            },
            {
              head: "Practitioner / sittings",
              cell: (row) => (
                <span className="text-muted-foreground">
                  <span className="capitalize">
                    {practitionerDisplayName(row.practitionerName)}
                  </span>{" "}
                  · <span className="tabular-nums">{row.sittingsDone}</span>{" "}
                  {row.sittingsDone === 1 ? "sitting" : "sittings"}
                  <span className="tabular-nums">{lastSittingLabel(row.lastSittingOn)}</span>
                </span>
              ),
            },
            {
              head: "Next sitting",
              cell: (row) => (
                <span>
                  <span className="whitespace-nowrap tabular-nums">
                    {row.nextSittingOn ? formatBusinessDate(row.nextSittingOn) : "Date not set"}
                  </span>
                  {" · "}
                  <span className="text-muted-foreground" title={row.nextSittingNote ?? undefined}>
                    {row.nextSittingNote ?? "No follow-up note"}
                  </span>
                </span>
              ),
            },
            {
              head: "Credit",
              cell: (row) => (
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatMoney(row.creditHeld, currency)}
                </span>
              ),
              className: "text-right",
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          link={(row) => ({
            to: "/$orgSlug/patients/$patientId/treatment",
            params: { orgSlug, patientId: row.patientId },
          })}
          action={
            canBook
              ? (row) => (
                  <Link
                    aria-label={`Book a sitting for ${row.patientName}`}
                    className={buttonVariants({ size: "icon-xs", variant: "ghost" })}
                    to="/$orgSlug/opd/new"
                    params={{ orgSlug }}
                    search={{ patientId: row.patientId, treatmentPlanId: row.id }}
                  >
                    <CalendarPlusIcon />
                  </Link>
                )
              : undefined
          }
        />
      </ListState>
    </Panel>
  );
}
