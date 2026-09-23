import { Button, buttonVariants } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClockIcon, CircleDotIcon, MoreHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useFormContext, Watch } from "react-hook-form";
import { z } from "zod";

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
  DataList,
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
import { formatDay } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { REASON_LABELS } from "@/lib/pharmacy-labels";
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
            <Link to="/$orgSlug/pharmacy/receive" params={{ orgSlug }} className={buttonVariants()}>
              Receive goods
            </Link>
          ) : null
        }
      />
      <PharmacyTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search stock"
            placeholder="Product, code, or batch"
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
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const stock = useInfiniteQuery(stockQuery(orgSlug, filters));
  const rows = stock.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Panel grow footer={<LoadMore query={stock} shown={rows.length} />}>
        <ListState
          query={stock}
          errorTitle="Could not load pharmacy stock"
          isEmpty={rows.length === 0}
          empty={filters.q ? "No batch matches this search" : "No stock matches these filters"}
        >
          <DataList
            columns={[
              {
                head: "Product",
                cell: (row) => (
                  <>
                    {row.name}{" "}
                    {row.code === null ? (
                      <span className="text-muted-foreground">Internal</span>
                    ) : (
                      <span className="font-mono text-muted-foreground">{row.code}</span>
                    )}
                  </>
                ),
              },
              {
                head: "Batch",
                cell: (row) => <span className="font-mono">{row.batchNumber}</span>,
                mobile: "title",
              },
              {
                head: "Expiry",
                cell: (row) => (
                  <span className="whitespace-nowrap">{formatDay(row.expiryDate)}</span>
                ),
              },
              {
                head: "MRP",
                cell: (row) => (
                  <span className="tabular-nums">
                    {formatMoney(row.mrp, currency)}
                    {row.mrpUnits > 1 ? ` / ${row.mrpUnits}` : ""}
                  </span>
                ),
                className: "text-right",
              },
              { head: "Unit", cell: (row) => row.stockUnit },
              {
                head: "Shelf",
                cell: (row) => <span className="tabular-nums">{row.shelfQty}</span>,
                className: "text-right",
              },
              {
                head: "Quarantine",
                cell: (row) => <span className="tabular-nums">{row.quarantineQty}</span>,
                className: "text-right",
              },
            ]}
            rows={rows}
            rowKey={(row) => row.batchId}
            action={(row) => (
              <BatchActions
                orgSlug={orgSlug}
                row={row}
                onAdjust={canAdjust ? () => setAdjusting(row) : undefined}
              />
            )}
          />
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

function BatchActions({
  orgSlug,
  row,
  onAdjust,
}: {
  orgSlug: string;
  row: StockRow;
  onAdjust?: () => void;
}) {
  return (
    <ClientOnly fallback={<span className="inline-block size-6" />}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-xs" />}
          aria-label={`Actions for ${row.name} batch ${row.batchNumber}`}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <Link
                  to="/$orgSlug/pharmacy/movements"
                  params={{ orgSlug }}
                  search={{ batchId: row.batchId }}
                />
              }
            >
              Movements
            </DropdownMenuItem>
            {onAdjust ? <DropdownMenuItem onClick={onAdjust}>Adjust stock</DropdownMenuItem> : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

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
