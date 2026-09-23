import { Button } from "@hms/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";

import { FilterChips } from "@/components/list-filter";
import {
  DataList,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
} from "@/components/page";
import { formatDateTime, formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { openOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { errorMessage, loadRouteQuery } from "@/lib/orpc-error";
import { REASON_LABELS } from "@/lib/pharmacy-labels";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

const movementsQuery = (orgSlug: string, batchId?: string) =>
  orpc.pharmacy.listMovements.infiniteOptions({
    input: (cursor: { createdAt: string; id: string } | undefined) => ({
      orgSlug,
      batchId,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/movements")({
  head: () => ({ meta: [{ title: "Stock movements · HMS" }] }),
  validateSearch: z.object({ batchId: z.string().min(1).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ batchId: search.batchId }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { pharmacy: ["read"] }, "/$orgSlug/dashboard");
    await loadRouteQuery(queryClient.infiniteQuery(movementsQuery(orgSlug, deps.batchId)));
  },
  component: PharmacyMovementsRoute,
});

function PharmacyMovementsRoute() {
  const { orgSlug } = Route.useParams();
  const { batchId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeZone } = useOrgDateTime();
  const movements = useInfiniteQuery(movementsQuery(orgSlug, batchId));
  const rows = movements.data?.pages.flatMap((page) => page.items) ?? [];
  const clearBatch = () => navigate({ replace: true, search: { batchId: undefined } });

  return (
    <>
      <PageHeader title="Stock movements" />
      <PharmacyTabs orgSlug={orgSlug} />
      <PageBody>
        {batchId ? (
          <ListToolbar>
            <FilterChips
              filters={[
                {
                  id: "batch",
                  name: "Batch",
                  label: rows[0]?.batchNumber ?? "This batch",
                  remove: clearBatch,
                },
              ]}
              onClear={() => void clearBatch()}
            />
          </ListToolbar>
        ) : null}
        <Panel grow footer={<LoadMore query={movements} shown={rows.length} />}>
          <ListState
            query={movements}
            errorTitle="Could not load stock movements"
            isEmpty={rows.length === 0}
            empty={batchId ? "No movements for this batch" : "No stock movements yet"}
          >
            <DataList
              columns={[
                {
                  head: "Product",
                  cell: (movement) => (
                    <>
                      <span>{movement.productName}</span>
                      <span className="block font-mono text-muted-foreground">
                        {movement.batchNumber}
                      </span>
                    </>
                  ),
                },
                {
                  head: "When",
                  cell: (movement) => (
                    <span className="whitespace-nowrap">
                      {formatDateTime(movement.createdAt, timeZone)}
                    </span>
                  ),
                },
                {
                  head: "Reason",
                  cell: (movement) => REASON_LABELS[movement.reason],
                  mobile: "title",
                },
                { head: "Bucket", cell: (movement) => movement.bucket },
                {
                  head: "Qty",
                  cell: (movement) => (
                    <span className="whitespace-nowrap tabular-nums">
                      {movement.qty} {movement.stockUnit}
                    </span>
                  ),
                  className: "text-right",
                },
                { head: "Department", cell: (movement) => movement.departmentName ?? "—" },
                {
                  head: "Source",
                  cell: (movement) => <MovementSource orgSlug={orgSlug} movement={movement} />,
                },
                {
                  head: "By",
                  cell: (movement) => <span className="capitalize">{movement.createdByName}</span>,
                },
              ]}
              rows={rows}
              rowKey={(movement) => movement.id}
            />
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}

type Movement = Awaited<ReturnType<typeof orpc.pharmacy.listMovements.call>>["items"][number];

function MovementSource({
  orgSlug,
  movement,
}: {
  orgSlug: string;
  movement: Pick<Movement, "receipt" | "note">;
}) {
  const receipt = movement.receipt;
  const fileId = receipt?.fileId;

  if (!receipt) return <span>{movement.note || "—"}</span>;

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <span>
          {receipt.opening
            ? "Opening count"
            : [receipt.supplierName, receipt.supplierReference].filter(Boolean).join(" · ") ||
              "Receipt"}
          <span className="text-muted-foreground">
            {" · "}
            {receipt.opening ? "counted" : "received"} {formatDay(receipt.receivedOn)}
          </span>
        </span>
        {fileId ? (
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              openOrgFile(orgSlug, fileId).catch((error) =>
                toast.error(errorMessage(error, "Could not open that receipt file")),
              )
            }
          >
            {receipt.opening ? "Sheet" : "Delivery note"}
          </Button>
        ) : null}
      </span>
      {movement.note ? <span>{movement.note}</span> : null}
    </span>
  );
}
