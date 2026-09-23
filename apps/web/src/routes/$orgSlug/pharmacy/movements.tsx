import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";

import { FilterChips } from "@/components/list-filter";
import { ListState, ListToolbar, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
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
            empty={batchId ? "No movements on this batch." : "No stock movements yet."}
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(movement.createdAt, timeZone)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{movement.productName}</span>
                        <span className="block font-mono text-muted-foreground">
                          {movement.batchNumber}
                        </span>
                      </TableCell>
                      <TableCell>{REASON_LABELS[movement.reason]}</TableCell>
                      <TableCell>{movement.bucket}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {movement.qty} {movement.stockUnit}
                      </TableCell>
                      <TableCell>{movement.departmentName ?? "—"}</TableCell>
                      <TableCell>
                        <MovementSource orgSlug={orgSlug} movement={movement} />
                      </TableCell>
                      <TableCell className="capitalize">{movement.createdByName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="md:hidden">
              {rows.map((movement) => (
                <li
                  key={movement.id}
                  className="border-b border-border/60 px-3 py-2 last:border-b-0"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{movement.productName}</p>
                      <p className="mt-1 truncate font-mono text-muted-foreground">
                        {movement.batchNumber} · {REASON_LABELS[movement.reason]}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-medium tabular-nums">
                      {movement.qty} {movement.stockUnit}
                    </p>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {formatDateTime(movement.createdAt, timeZone)} · {movement.bucket}
                    {movement.departmentName ? ` · ${movement.departmentName}` : ""}
                  </p>
                  <div className="mt-1 text-muted-foreground">
                    <MovementSource orgSlug={orgSlug} movement={movement} />
                  </div>
                  <p className="mt-1 text-muted-foreground capitalize">
                    By {movement.createdByName}
                  </p>
                </li>
              ))}
            </ul>
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
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1">
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
      </div>
      {movement.note ? <span>{movement.note}</span> : null}
    </div>
  );
}
