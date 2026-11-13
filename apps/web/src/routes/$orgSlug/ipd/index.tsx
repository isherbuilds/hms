import { Button, buttonVariants } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { appHead } from "@/config/site";
import {
  AdmissionStatusBadge,
  AdmitDialog,
  BedStatusBadge,
  BlockBedDialog,
} from "@/components/ipd-dialogs";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { useCan } from "@/lib/membership";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { IpdTabs } from "./route";

const boardQuery = (orgSlug: string) => orpc.ipd.bedBoard.queryOptions({ input: { orgSlug } });

export const Route = createFileRoute("/$orgSlug/ipd/")({
  head: () => appHead("Beds"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { ipd: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.query(boardQuery(orgSlug)).catch(() => {});
  },
  component: BedBoardRoute,
});

type Board = Awaited<ReturnType<typeof orpc.ipd.bedBoard.call>>;

type BoardBed = Board["beds"][number];

function BedBoardRoute() {
  const { orgSlug } = Route.useParams();
  const board = useQuery(boardQuery(orgSlug));
  const canManage = useCan(orgSlug, { ipd: ["manageFacility"] });
  const [admitting, setAdmitting] = useState<BoardBed | null>(null);
  const [blocking, setBlocking] = useState<BoardBed | null>(null);

  const beds = board.data?.beds ?? [];
  // The server orders by ward, so each ward's beds arrive together.
  const wards = new Map<string, BoardBed[]>();

  for (const bed of beds) wards.set(bed.wardId, [...(wards.get(bed.wardId) ?? []), bed]);

  const count = (status: BoardBed["status"]) => beds.filter((bed) => bed.status === status).length;

  return (
    <>
      <PageHeader title="IPD" />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody>
        {beds.length > 0 ? (
          <p className="text-muted-foreground tabular-nums">
            {count("available")} free · {count("occupied")} occupied · {count("blocked")} blocked
          </p>
        ) : null}

        <ListState
          query={board}
          errorTitle="Could not load the beds"
          isEmpty={beds.length === 0}
          empty={
            <Panel>
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
                <p>No beds yet</p>
                {canManage ? (
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    to="/$orgSlug/ipd/facility"
                    params={{ orgSlug }}
                  >
                    Set up wards and beds
                  </Link>
                ) : (
                  <p>An administrator sets up wards and beds.</p>
                )}
              </div>
            </Panel>
          }
        >
          {[...wards.values()].map((wardBeds) => (
            <Panel
              key={wardBeds[0]!.wardId}
              label={wardBeds[0]!.wardName}
              action={
                <span className="tabular-nums">
                  {wardBeds.filter((bed) => bed.status === "available").length} of {wardBeds.length}{" "}
                  free
                </span>
              }
              minHeight=""
            >
              <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {wardBeds.map((bed) => (
                  <BedTile
                    key={bed.id}
                    orgSlug={orgSlug}
                    bed={bed}
                    onAdmit={() => setAdmitting(bed)}
                    onBlock={() => setBlocking(bed)}
                  />
                ))}
              </ul>
            </Panel>
          ))}
        </ListState>
      </PageBody>

      {admitting ? (
        <AdmitDialog orgSlug={orgSlug} bed={admitting} onClose={() => setAdmitting(null)} />
      ) : null}
      {blocking ? (
        <BlockBedDialog orgSlug={orgSlug} bed={blocking} onClose={() => setBlocking(null)} />
      ) : null}
    </>
  );
}

const SHOWN_HOLDS = 2;

// Holds are promises for later, not occupancy: listed apart from the occupant and the block.
function BedHolds({ holds }: { holds: BoardBed["holds"] }) {
  const { timeZone } = useOrgDateTime();

  if (holds.length === 0) return null;

  return (
    <ul className="flex flex-col text-muted-foreground">
      {holds.slice(0, SHOWN_HOLDS).map((hold) => (
        <li key={hold.reservationId} className="truncate">
          Held for <span className="capitalize">{hold.patientName}</span> ·{" "}
          <span className="tabular-nums">{formatDateTime(hold.plannedArrivalAt, timeZone)}</span>
        </li>
      ))}
      {holds.length > SHOWN_HOLDS ? <li>+{holds.length - SHOWN_HOLDS} more</li> : null}
    </ul>
  );
}

function BedTile({
  orgSlug,
  bed,
  onAdmit,
  onBlock,
}: {
  orgSlug: string;
  bed: BoardBed;
  onAdmit: () => void;
  onBlock: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const canAdmit = useCan(orgSlug, { ipd: ["create"] });
  const canUpdate = useCan(orgSlug, { ipd: ["update"] });

  const release = useMutation(
    orpc.ipd.releaseBed.mutationOptions({
      onSuccess: () => toast.success(`Bed ${bed.label} released`),
    }),
  );

  const heading = (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono font-medium">{bed.label}</span>
      {bed.admission ? (
        <AdmissionStatusBadge status={bed.admission.status} />
      ) : (
        <BedStatusBadge status={bed.status} />
      )}
    </div>
  );

  if (bed.admission) {
    const { admission } = bed;

    return (
      <li className="bg-card">
        <Link
          to="/$orgSlug/ipd/$admissionId"
          params={{ orgSlug, admissionId: admission.id }}
          className="flex h-full min-h-24 flex-col gap-1 p-3 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60"
        >
          {heading}
          <span className="truncate font-medium capitalize" title={admission.patientName}>
            {admission.patientName}
          </span>
          <span className="truncate text-muted-foreground">
            <span className="font-mono">{admission.mrn}</span> · since{" "}
            {formatDateTime(admission.admittedAt, timeZone)}
          </span>
          <BedHolds holds={bed.holds} />
        </Link>
      </li>
    );
  }

  return (
    <li className="flex min-h-24 flex-col gap-1 bg-card p-3">
      {heading}
      <span className="text-muted-foreground">{bed.categoryName}</span>
      {bed.status === "blocked" ? (
        <span className="truncate text-muted-foreground" title={bed.blockedReason ?? undefined}>
          {bed.blockedReason}
        </span>
      ) : null}
      <BedHolds holds={bed.holds} />
      {bed.status === "blocked" ? (
        canUpdate ? (
          <Button
            className="mt-auto self-start"
            variant="outline"
            aria-label={`Release bed ${bed.label}`}
            disabled={release.isPending}
            onClick={() =>
              release.mutate({ orgSlug, bedId: bed.id, expectedBlockedAt: bed.blockedAt! })
            }
          >
            Release bed
          </Button>
        ) : null
      ) : (
        <div className="mt-auto flex items-center justify-between gap-2">
          {!bed.rateSet ? (
            <span className="text-muted-foreground">No rate set</span>
          ) : canAdmit ? (
            // A held bed is not free for a walk-in: the dialog shows the server's refusal.
            <Button
              variant={bed.holds.length > 0 ? "outline" : "default"}
              aria-label={`Admit to bed ${bed.label}`}
              onClick={onAdmit}
            >
              Admit
            </Button>
          ) : (
            <span />
          )}
          {canUpdate ? (
            <ClientOnly fallback={null}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-xs" />}
                  aria-label={`More for bed ${bed.label}`}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-36">
                  <DropdownMenuItem onClick={onBlock}>Block bed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ClientOnly>
          ) : null}
        </div>
      )}
    </li>
  );
}
