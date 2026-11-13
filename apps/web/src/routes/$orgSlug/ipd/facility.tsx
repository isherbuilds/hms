import { Button } from "@hms/ui/components/button";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { appHead } from "@/config/site";
import { useConfirm } from "@/components/confirm-dialog";
import { BedCategoryDialog, BedDialog, TariffDialog, WardDialog } from "@/components/ipd-dialogs";
import { DataList, ListState, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { IpdTabs } from "./route";

const facilityQuery = (orgSlug: string) => orpc.ipd.facility.queryOptions({ input: { orgSlug } });

const servicesQuery = (orgSlug: string) =>
  orpc.catalog.list.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      activeOnly: true,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/ipd/facility")({
  head: () => appHead("Wards and beds"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { ipd: ["manageFacility"] }, "/$orgSlug/ipd");
    await Promise.all([
      queryClient.query(facilityQuery(orgSlug)).catch(() => {}),
      queryClient.infiniteQuery(servicesQuery(orgSlug)).catch(() => {}),
    ]);
  },
  component: FacilityRoute,
});

type Facility = Awaited<ReturnType<typeof orpc.ipd.facility.call>>;

type Category = Facility["categories"][number];

type Open = "ward" | "category" | "bed" | { tariffFor: Category } | null;

function FacilityRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const [open, setOpen] = useState<Open>(null);
  const [confirm, confirmDialog] = useConfirm();

  const facility = useQuery(facilityQuery(orgSlug));
  const services = useInfiniteQuery(servicesQuery(orgSlug));
  const serviceOptions = services.data?.pages.flatMap((page) => page.items) ?? [];

  const setActive = useMutation(
    orpc.ipd.setBedActive.mutationOptions({
      onSuccess: (bed) =>
        toast.success(bed.active ? `Bed ${bed.label} in use` : `Bed ${bed.label} retired`),
    }),
  );

  const wards = facility.data?.wards ?? [];
  const categories = facility.data?.categories ?? [];
  const beds = facility.data?.beds ?? [];
  const wardName = new Map(wards.map((ward) => [ward.id, ward.name]));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const close = () => setOpen(null);

  return (
    <>
      <PageHeader
        title="IPD"
        action={
          <Button disabled={!wards.length || !categories.length} onClick={() => setOpen("bed")}>
            New bed
          </Button>
        }
      />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody width="max-w-5xl">
        <ListState
          query={facility}
          errorTitle="Could not load wards and beds"
          isEmpty={false}
          empty={null}
        >
          <Panel
            label="Wards"
            minHeight=""
            action={
              <Button size="xs" variant="ghost" onClick={() => setOpen("ward")}>
                New ward
              </Button>
            }
          >
            {wards.length ? (
              <ul className="divide-y divide-border">
                {wards.map((ward) => (
                  <li key={ward.id} className="flex h-10 items-center justify-between px-3">
                    <span>{ward.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {beds.filter((bed) => bed.wardId === ward.id && bed.active).length} beds
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-muted-foreground">Add a ward, then bed types and beds.</p>
            )}
          </Panel>

          <Panel
            label="Bed types and daily rates"
            minHeight=""
            action={
              <Button size="xs" variant="ghost" onClick={() => setOpen("category")}>
                New bed type
              </Button>
            }
          >
            {categories.length ? (
              <DataList
                columns={[
                  { head: "Bed type", cell: (category) => category.name, mobile: "title" },
                  {
                    head: "Billed as",
                    cell: (category) => category.currentTariff?.serviceName ?? "—",
                  },
                  {
                    head: "Since",
                    cell: (category) =>
                      category.currentTariff ? (
                        <span className="whitespace-nowrap tabular-nums">
                          {formatDateTime(category.currentTariff.effectiveFrom, timeZone)}
                        </span>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    head: "Daily rate",
                    cell: (category) =>
                      category.currentTariff ? (
                        <span className="tabular-nums">
                          {formatMoney(category.currentTariff.dailyPrice, currency)}
                        </span>
                      ) : (
                        <span className="text-destructive">No rate: beds cannot be taken</span>
                      ),
                    className: "text-right",
                  },
                ]}
                rows={categories}
                rowKey={(category) => category.id}
                action={(category) => (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setOpen({ tariffFor: category })}
                  >
                    Set rate
                  </Button>
                )}
              />
            ) : (
              <p className="p-3 text-muted-foreground">
                Add a bed type such as General or Private room, then its daily rate.
              </p>
            )}
          </Panel>

          <Panel label="Beds" minHeight="">
            {beds.length ? (
              <DataList
                columns={[
                  {
                    head: "Bed",
                    cell: (bed) => <span className="font-mono">{bed.label}</span>,
                    mobile: "title",
                  },
                  { head: "Ward", cell: (bed) => wardName.get(bed.wardId) ?? "—" },
                  { head: "Type", cell: (bed) => categoryName.get(bed.categoryId) ?? "—" },
                  {
                    head: "Use",
                    cell: (bed) =>
                      bed.active ? (
                        "In use"
                      ) : (
                        <span className="text-muted-foreground">Retired</span>
                      ),
                  },
                ]}
                rows={beds}
                rowKey={(bed) => bed.id}
                action={(bed) =>
                  bed.active ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={setActive.isPending}
                      onClick={() =>
                        confirm({
                          title: `Retire bed ${bed.label}?`,
                          description:
                            "It leaves the board and takes no admissions. Its history is kept.",
                          confirmLabel: "Retire bed",
                          run: () => setActive.mutate({ orgSlug, bedId: bed.id, active: false }),
                        })
                      }
                    >
                      Retire
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ orgSlug, bedId: bed.id, active: true })}
                    >
                      Use again
                    </Button>
                  )
                }
              />
            ) : (
              <p className="p-3 text-muted-foreground">No beds yet.</p>
            )}
          </Panel>
        </ListState>
      </PageBody>

      {open === "ward" ? <WardDialog orgSlug={orgSlug} onClose={close} /> : null}
      {open === "category" ? <BedCategoryDialog orgSlug={orgSlug} onClose={close} /> : null}
      {open === "bed" ? (
        <BedDialog orgSlug={orgSlug} wards={wards} categories={categories} onClose={close} />
      ) : null}
      {open !== null && typeof open === "object" ? (
        <TariffDialog
          orgSlug={orgSlug}
          category={open.tariffFor}
          services={serviceOptions}
          servicesFooter={<LoadMore query={services} shown={serviceOptions.length} />}
          onClose={close}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}
