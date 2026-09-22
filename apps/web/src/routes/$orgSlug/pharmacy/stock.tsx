import { Button } from "@hms/ui/components/button";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClockIcon, CircleDotIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { useFormContext, Watch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import {
  ErrorNote,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { numberText } from "@/lib/form-schema";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { openOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { errorMessage, loadRouteQuery } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

// Kept local so no @hms/db server module reaches the client bundle (hard rule 6).
const ADJUST_REASONS = [
  "release",
  "quarantine",
  "writeoff",
  "breakage",
  "count_correction",
  "internal_issue",
] as const;

const BUCKETS = ["shelf", "quarantine"] as const;

// Every movement reason, so the adjustment select and the movement list read the same.
const REASON_LABELS: Record<string, string> = {
  opening: "Opening",
  receipt: "Receipt",
  sale: "Sale",
  return: "Return",
  release: "Release to shelf",
  quarantine: "Hold in quarantine",
  writeoff: "Write off",
  breakage: "Breakage",
  count_correction: "Count correction",
  internal_issue: "Internal issue",
};

const EXPIRING_DAYS = [30, 90] as const;

// Absent is the sellable shelf; the two views widen it independently.
const VIEWS = [
  { id: "quarantine", label: "Quarantine only" },
  { id: "zero", label: "Include zero" },
] as const;

type StockFilters = { q?: string; expiring?: 30 | 90; quarantine?: true; zero?: true };

const stockQuery = (orgSlug: string, filters: StockFilters) =>
  orpc.pharmacy.stockOnHand.infiniteOptions({
    input: (cursor: { expiryDate: string; batchId: string } | undefined) => ({
      orgSlug,
      query: filters.q,
      expiringWithinDays: filters.expiring,
      quarantineOnly: filters.quarantine ?? false,
      includeZero: filters.zero ?? false,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/stock")({
  head: () => ({ meta: [{ title: "Pharmacy stock · HMS" }] }),
  validateSearch: z.object({
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    expiring: z
      .union([z.literal(30), z.literal(90)])
      .optional()
      .catch(undefined),
    quarantine: z.literal(true).optional().catch(undefined),
    zero: z.literal(true).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    expiring: search.expiring,
    quarantine: search.quarantine,
    zero: search.zero,
  }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { pharmacy: ["read"] }, "/$orgSlug/dashboard");
    await loadRouteQuery(queryClient.infiniteQuery(stockQuery(orgSlug, deps)));
  },
  component: PharmacyStockRoute,
});

/** One batch as `stockOnHand` returns it; the Adjust dialog needs the row it was launched from. */
type StockRow = {
  batchId: string;
  name: string;
  batchNumber: string;
};

function PharmacyStockRoute() {
  const { orgSlug } = Route.useParams();
  const { q, expiring, quarantine, zero } = Route.useSearch();
  const navigate = Route.useNavigate();
  const canReceive = useCan(orgSlug, { pharmacy: ["receive"] });

  const field = useRef<HTMLDivElement>(null);

  const setFilters = (patch: StockFilters) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, expiring: undefined, quarantine: undefined, zero: undefined });
  };

  const applied = { quarantine, zero };

  const chips: ActiveFilter[] = [
    ...(expiring === undefined
      ? []
      : [
          {
            id: "expiring",
            name: "Expiry",
            label: `Within ${expiring} days`,
            remove: () => setFilters({ expiring: undefined }),
          },
        ]),
    ...VIEWS.flatMap((candidate) =>
      applied[candidate.id]
        ? [
            {
              id: candidate.id,
              name: "View",
              label: candidate.label,
              remove: () => setFilters({ [candidate.id]: undefined }),
            },
          ]
        : [],
    ),
  ];

  return (
    <>
      <PageHeader
        title="Pharmacy stock"
        action={
          canReceive ? (
            <Button render={<Link to="/$orgSlug/pharmacy/receive" params={{ orgSlug }} />}>
              Receive goods
            </Button>
          ) : null
        }
      />
      <PharmacyTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search stock"
            placeholder="Search product, code or batch"
            value={q}
            fieldRef={field}
            delay={150}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={CalendarClockIcon} label="Expiry">
                  {EXPIRING_DAYS.map((days) => (
                    <DropdownMenuCheckboxItem
                      key={days}
                      checked={expiring === days}
                      onCheckedChange={(checked) =>
                        void setFilters({ expiring: checked ? days : undefined })
                      }
                    >
                      Within {days} days
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <FilterSubmenu icon={CircleDotIcon} label="View">
                  {VIEWS.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate.id}
                      checked={applied[candidate.id] === true}
                      onCheckedChange={(checked) =>
                        void setFilters({ [candidate.id]: checked ? true : undefined })
                      }
                    >
                      {candidate.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        {/* Only search may retain previous rows; other filters remount this actionable list (D037). */}
        <StockBatches
          key={`${expiring ?? ""}:${quarantine ?? ""}:${zero ?? ""}`}
          orgSlug={orgSlug}
          filters={{ q, expiring, quarantine, zero }}
        />
      </PageBody>
    </>
  );
}

function StockBatches({ orgSlug, filters }: { orgSlug: string; filters: StockFilters }) {
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const canAdjust = useCan(orgSlug, { pharmacy: ["adjust"] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const stock = useInfiniteQuery(stockQuery(orgSlug, filters));
  const rows = stock.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Panel label="Batches" grow footer={<LoadMore query={stock} shown={rows.length} />}>
        <ListState
          query={stock}
          errorTitle="Could not load pharmacy stock"
          isEmpty={rows.length === 0}
          empty={filters.q ? "No batch matches this search." : "No stock matches these filters."}
        >
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">MRP</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Shelf</TableHead>
                  <TableHead className="text-right">Quarantine</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.batchId}>
                    <TableRow>
                      <TableCell className="font-medium">
                        {row.name}{" "}
                        {row.code === null ? (
                          <span className="text-muted-foreground">Internal</span>
                        ) : (
                          <span className="font-mono text-muted-foreground">{row.code}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{row.batchNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDay(row.expiryDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.mrp, currency)}
                      </TableCell>
                      <TableCell>{row.stockUnit}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.shelfQty}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.quarantineQty}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setExpanded((current) => (current === row.batchId ? null : row.batchId))
                          }
                        >
                          Movements
                        </Button>
                        {canAdjust ? (
                          <Button variant="ghost" size="xs" onClick={() => setAdjusting(row)}>
                            Adjust
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {expanded === row.batchId ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <BatchMovements orgSlug={orgSlug} batchId={row.batchId} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="md:hidden">
            {rows.map((row) => (
              <li key={row.batchId} className="border-b border-border/60 px-3 py-2 last:border-b-0">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="mt-1 truncate font-mono text-muted-foreground">
                      {row.batchNumber} · {formatDay(row.expiryDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="font-medium">{row.shelfQty}</p>
                    <p className="mt-1 text-muted-foreground">{row.quarantineQty} held</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      setExpanded((current) => (current === row.batchId ? null : row.batchId))
                    }
                  >
                    Movements
                  </Button>
                  {canAdjust ? (
                    <Button variant="ghost" size="xs" onClick={() => setAdjusting(row)}>
                      Adjust
                    </Button>
                  ) : null}
                </div>
                {expanded === row.batchId ? (
                  <BatchMovements orgSlug={orgSlug} batchId={row.batchId} />
                ) : null}
              </li>
            ))}
          </ul>
        </ListState>
      </Panel>

      {adjusting ? (
        <AdjustDialog
          key={adjusting.batchId}
          orgSlug={orgSlug}
          batch={adjusting}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
    </>
  );
}

function BatchMovements({ orgSlug, batchId }: { orgSlug: string; batchId: string }) {
  const { timeZone } = useOrgDateTime();

  const movements = useQuery(
    orpc.pharmacy.listMovements.queryOptions({ input: { orgSlug, batchId } }),
  );

  if (movements.isPending) {
    return <p className="text-muted-foreground">Loading movements…</p>;
  }

  if (movements.isError) {
    return <ErrorNote title="Could not load movements" error={movements.error} inset />;
  }

  if (movements.data.length === 0) {
    return <p className="text-muted-foreground">No movements on this batch.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Bucket</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {movements.data.map((movement) => {
          const sheetId = movement.receipt?.fileId ?? null;

          return (
            <TableRow key={movement.id}>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(movement.createdAt, timeZone)}
              </TableCell>
              <TableCell>{REASON_LABELS[movement.reason] ?? movement.reason}</TableCell>
              <TableCell>{movement.bucket}</TableCell>
              <TableCell className="text-right tabular-nums">{movement.qty}</TableCell>
              <TableCell>{movement.departmentName ?? "—"}</TableCell>
              <TableCell className="text-xs">
                {movement.receipt ? (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span>
                        {movement.receipt.opening
                          ? "Opening count"
                          : [movement.receipt.supplierName, movement.receipt.supplierReference]
                              .filter(Boolean)
                              .join(" · ") || "Receipt"}
                        <span className="text-muted-foreground">
                          {" · "}
                          {movement.receipt.opening ? "counted" : "received"}{" "}
                          {formatDay(movement.receipt.receivedOn)}
                        </span>
                      </span>
                      {sheetId ? (
                        <Button
                          variant="link"
                          size="xs"
                          onClick={() =>
                            openOrgFile(orgSlug, sheetId).catch((error) =>
                              toast.error(errorMessage(error, "Could not open that receipt file")),
                            )
                          }
                        >
                          {movement.receipt.opening ? "Sheet" : "Delivery note"}
                        </Button>
                      ) : null}
                    </div>
                    {movement.note ? <span>{movement.note}</span> : null}
                  </div>
                ) : (
                  movement.note || "—"
                )}
              </TableCell>
              <TableCell className="capitalize">{movement.createdByName}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const adjustSchema = z
  .object({
    reason: z.enum(ADJUST_REASONS),
    qty: numberText(
      z
        .number()
        .int()
        .refine((value) => value !== 0, "Enter a quantity"),
    ),
    bucket: z.enum(BUCKETS),
    departmentId: z.string(),
    note: z.string().trim().min(1, "Explain this adjustment").max(500),
  })
  .superRefine((value, context) => {
    if (value.qty < 0 && value.reason !== "count_correction") {
      context.addIssue({
        code: "custom",
        path: ["qty"],
        message: "Enter a positive quantity",
      });
    }

    if (value.reason === "internal_issue" && value.departmentId === "") {
      context.addIssue({
        code: "custom",
        path: ["departmentId"],
        message: "Choose the department",
      });
    }
  });

const BUCKET_REASONS = ["writeoff", "breakage", "count_correction"];

function AdjustDialog({
  orgSlug,
  batch,
  onClose,
}: {
  orgSlug: string;
  batch: StockRow;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Adjust stock"
      description={`${batch.name} · batch ${batch.batchNumber}`}
      submitLabel="Adjust stock"
      schema={adjustSchema}
      defaultValues={{
        reason: "release",
        qty: "",
        bucket: "shelf",
        departmentId: "",
        note: "",
      }}
      success="Stock adjusted"
      onClose={onClose}
      run={(values) =>
        orpc.pharmacy.adjustStock.call({
          orgSlug,
          batchId: batch.batchId,
          reason: values.reason,
          qty: values.qty,
          bucket: BUCKET_REASONS.includes(values.reason) ? values.bucket : undefined,
          departmentId: values.reason === "internal_issue" ? values.departmentId : undefined,
          note: values.note,
        })
      }
    >
      <ControlledField
        name="reason"
        label="Reason"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              {ADJUST_REASONS.map((option) => (
                <option key={option} value={option}>
                  {REASON_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <TextField
        name="qty"
        label="Quantity"
        inputMode="numeric"
        description="A count correction may be negative."
      />
      <ReasonFields orgSlug={orgSlug} />
      <TextField name="note" label="Note" multiline />
    </FormDialog>
  );
}

/** Only some reasons pick a side of the shelf, and only an internal issue names a department. */
function ReasonFields({ orgSlug }: { orgSlug: string }) {
  const { control } = useFormContext();

  return (
    <Watch
      control={control}
      name="reason"
      exact
      render={(reason) =>
        BUCKET_REASONS.includes(String(reason)) ? (
          <ControlledField
            name="bucket"
            label="Bucket"
            render={(field) => (
              <FormControl>
                <NativeSelect {...field}>
                  {BUCKETS.map((bucket) => (
                    <option key={bucket} value={bucket}>
                      {bucket}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
            )}
          />
        ) : reason === "internal_issue" ? (
          <DepartmentField orgSlug={orgSlug} />
        ) : null
      }
    />
  );
}

function DepartmentField({ orgSlug }: { orgSlug: string }) {
  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));

  return (
    <ControlledField
      name="departmentId"
      label="Department"
      render={(field) => (
        <FormControl>
          <NativeSelect {...field} disabled={departments.isPending}>
            <option value="">
              {departments.isPending ? "Loading departments…" : "Choose a department"}
            </option>
            {(departments.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </NativeSelect>
        </FormControl>
      )}
    />
  );
}
