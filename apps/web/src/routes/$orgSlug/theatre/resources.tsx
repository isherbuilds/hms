import { Button } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { appHead } from "@/config/site";
import { useConfirm } from "@/components/confirm-dialog";
import { DataList, ListState, PageBody, PageHeader, Panel } from "@/components/page";
import {
  BlockDialog,
  EquipmentDialog,
  ROOM_KIND_LABELS,
  RoomDialog,
  resourcesQuery,
  type BlockTarget,
  type TheatreResources,
} from "@/components/theatre-dialogs";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { TheatreTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/theatre/resources")({
  head: () => appHead("Rooms and equipment"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { theatre: ["manageResources"] },
      "/$orgSlug/theatre",
    );
    await queryClient.query(resourcesQuery(orgSlug)).catch(() => {});
  },
  component: ResourcesRoute,
});

type Resource = TheatreResources["rooms" | "equipment"][number];

type Open = "room" | "equipment" | { block: BlockTarget } | null;

function ResourcesRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const resources = useQuery(resourcesQuery(orgSlug));
  const [open, setOpen] = useState<Open>(null);
  const [confirm, confirmDialog] = useConfirm();
  const close = () => setOpen(null);

  const setRoomActive = useMutation(
    orpc.theatre.setRoomActive.mutationOptions({
      onSuccess: (room) => toast.success(`${room.name} ${room.active ? "in use" : "out of use"}`),
    }),
  );

  const setUnitActive = useMutation(
    orpc.theatre.setEquipmentActive.mutationOptions({
      onSuccess: (unit) => toast.success(`${unit.name} ${unit.active ? "in use" : "out of use"}`),
    }),
  );

  const removeBlock = useMutation(
    orpc.theatre.removeBlock.mutationOptions({ onSuccess: () => toast.success("Block removed") }),
  );

  const rooms = resources.data?.rooms ?? [];
  const equipment = resources.data?.equipment ?? [];
  const blocks = resources.data?.blocks ?? [];

  const names = new Map<string, string>(
    [...rooms, ...equipment].map((resource) => [resource.id, resource.name]),
  );

  const stopUsing = (name: string, run: () => void) =>
    confirm({
      title: `Stop using ${name}?`,
      description:
        "No new case can be booked on it. Its past cases are kept. It cannot be stopped while a confirmed case still needs it.",
      confirmLabel: "Stop using",
      run,
    });

  const use = (resource: Resource) =>
    resource.active ? "In use" : <span className="text-muted-foreground">Not in use</span>;

  const actions = (
    resource: Resource,
    target: BlockTarget,
    setActive: (active: boolean) => void,
  ) =>
    resource.active ? (
      <div className="flex items-center justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={() => setOpen({ block: target })}>
          Block
        </Button>
        <ClientOnly fallback={null}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" />}
              aria-label={`More for ${resource.name}`}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={() => stopUsing(resource.name, () => setActive(false))}>
                Stop using
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </div>
    ) : (
      <Button size="xs" variant="ghost" onClick={() => setActive(true)}>
        Use again
      </Button>
    );

  return (
    <>
      <PageHeader title="Theatre" />
      <TheatreTabs orgSlug={orgSlug} />

      <PageBody width="max-w-5xl">
        <ListState
          query={resources}
          errorTitle="Could not load rooms and equipment"
          isEmpty={false}
          empty={null}
        >
          <Panel
            label="Rooms"
            minHeight=""
            action={
              <Button size="xs" variant="ghost" onClick={() => setOpen("room")}>
                Add room
              </Button>
            }
          >
            {rooms.length ? (
              <DataList
                wrap
                columns={[
                  { head: "Room", cell: (room) => room.name },
                  { head: "Kind", cell: (room) => ROOM_KIND_LABELS[room.kind] },
                  { head: "Use", cell: use },
                ]}
                rows={rooms}
                rowKey={(room) => room.id}
                action={(room) =>
                  actions(room, { roomId: room.id, name: room.name }, (active) =>
                    setRoomActive.mutate({ orgSlug, roomId: room.id, active }),
                  )
                }
              />
            ) : (
              <p className="p-3 text-muted-foreground">
                Add each operating theatre and procedure room cases are booked into.
              </p>
            )}
          </Panel>

          <Panel
            label="Equipment"
            minHeight=""
            action={
              <Button size="xs" variant="ghost" onClick={() => setOpen("equipment")}>
                Add equipment
              </Button>
            }
          >
            {equipment.length ? (
              <DataList
                wrap
                columns={[
                  { head: "Unit", cell: (unit) => unit.name },
                  { head: "Kind", cell: (unit) => unit.kind },
                  { head: "Use", cell: use },
                ]}
                rows={equipment}
                rowKey={(unit) => unit.id}
                action={(unit) =>
                  actions(unit, { equipmentId: unit.id, name: unit.name }, (active) =>
                    setUnitActive.mutate({ orgSlug, equipmentId: unit.id, active }),
                  )
                }
              />
            ) : (
              <p className="p-3 text-muted-foreground">
                Add the units a case can need, such as a C-arm, one by one.
              </p>
            )}
          </Panel>

          <Panel label="Current and upcoming blocks" minHeight="">
            {blocks.length ? (
              <DataList
                wrap
                columns={[
                  {
                    head: "Room or unit",
                    cell: (block) => names.get(block.roomId ?? block.equipmentId!) ?? "—",
                  },
                  {
                    head: "When",
                    cell: (block) => (
                      <span className="tabular-nums">
                        {formatDateTime(block.startsAt, timeZone)} →{" "}
                        {formatDateTime(block.endsAt, timeZone)}
                      </span>
                    ),
                  },
                  { head: "Reason", cell: (block) => block.reason },
                ]}
                rows={blocks}
                rowKey={(block) => block.id}
                action={(block) => {
                  const name = names.get(block.roomId ?? block.equipmentId!) ?? "this room or unit";

                  return (
                    <ClientOnly fallback={null}>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-xs" />}
                          aria-label={`More for the block on ${name}`}
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem
                            disabled={removeBlock.isPending}
                            onClick={() =>
                              confirm({
                                title: `Remove the block on ${name}?`,
                                description:
                                  "Cases can then be confirmed on it at that time. Remove it only once the work is cancelled or done.",
                                confirmLabel: "Remove block",
                                run: () => removeBlock.mutate({ orgSlug, blockId: block.id }),
                              })
                            }
                          >
                            Remove block
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ClientOnly>
                  );
                }}
              />
            ) : (
              <p className="p-3 text-muted-foreground">Nothing is blocked.</p>
            )}
          </Panel>
        </ListState>
      </PageBody>

      {open === "room" ? <RoomDialog orgSlug={orgSlug} onClose={close} /> : null}
      {open === "equipment" ? <EquipmentDialog orgSlug={orgSlug} onClose={close} /> : null}
      {open !== null && typeof open === "object" ? (
        <BlockDialog orgSlug={orgSlug} target={open.block} onClose={close} />
      ) : null}
      {confirmDialog}
    </>
  );
}
