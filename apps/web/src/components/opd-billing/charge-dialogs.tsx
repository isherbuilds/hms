import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatMoney, MONEY_INPUT_PATTERN } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { toastOpdConflict } from "@/lib/opd-operational-query";

import { useBillingInvalidation } from "./use-billing-invalidation";

const voidSchema = z.object({ reason: z.string().trim().min(1, "Enter a reason").max(500) });

const invoiceSchema = z
  .object({
    discountAmount: z.string().regex(MONEY_INPUT_PATTERN, "Amount like 0 or 50.00"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => Number(value.discountAmount) <= 0 || Boolean(value.note), {
    path: ["note"],
    message: "A reason is required when applying a discount",
  });

export function AddChargeDialog({
  open,
  onOpenChange,
  orgSlug,
  appointmentId,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  appointmentId: string;
  currency: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const [query, setQuery] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [selected, setSelected] = useState<
    Array<{ catalogItemId: string; code: string; name: string; unitPrice: string; qty: number }>
  >([]);
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 250);
  const catalog = useQuery({
    ...orpc.catalog.searchServices.queryOptions({
      input: { orgSlug, query: debouncedQuery || undefined },
    }),
    enabled: debouncedQuery.length > 0 && debouncedQuery === normalizedQuery,
  });
  const mutation = useMutation(
    orpc.billing.addCharges.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(selected.length === 1 ? "Charge added" : `${selected.length} charges added`);
        onOpenChange(false);
        setQuery("");
        setSelected([]);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const selectedIds = new Set(selected.map((item) => item.catalogItemId));
  const results =
    debouncedQuery === normalizedQuery
      ? (catalog.data ?? []).filter((item) => !selectedIds.has(item.id))
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add charge</DialogTitle>
          <DialogDescription>
            Add an active service from the organization catalog.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected.length === 0) return;
            mutation.mutate({
              orgSlug,
              appointmentId,
              lines: selected.map(({ catalogItemId, qty }) => ({ catalogItemId, qty })),
            });
          }}
        >
          <label className="grid gap-1.5">
            <span>Catalog items</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 z-10 size-3.5 text-muted-foreground" />
              <Combobox
                items={results}
                getItemKey={(item) => item.id}
                getItemLabel={(item) => item.name}
                inputValue={query}
                onInputValueChange={setQuery}
                onSelect={(item) => {
                  setSelected([
                    ...selected,
                    {
                      catalogItemId: item.id,
                      code: item.code,
                      name: item.name,
                      unitPrice: item.unitPrice,
                      qty: 1,
                    },
                  ]);
                  setQuery("");
                  setComboOpen(false);
                }}
                open={comboOpen && normalizedQuery.length > 0}
                onOpenChange={setComboOpen}
                disabled={mutation.isPending}
                inputClassName="pl-8"
                inputProps={{
                  autoComplete: "off",
                  placeholder: "Search code, name or category",
                  onFocus: () => {
                    if (normalizedQuery) setComboOpen(true);
                  },
                }}
                renderItem={(item) => (
                  <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="font-mono text-muted-foreground">{item.code}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(item.unitPrice, currency)}</span>
                  </div>
                )}
                emptyContent={
                  normalizedQuery ? (
                    <p className="px-3 py-2 text-muted-foreground">
                      {catalog.isError
                        ? catalog.error.message
                        : catalog.isPending || debouncedQuery !== normalizedQuery
                          ? "Searching…"
                          : "No unused item matches"}
                    </p>
                  ) : undefined
                }
              />
            </div>
          </label>
          {selected.length > 0 ? (
            <div className="divide-y divide-border border-y border-border">
              {selected.map((item) => (
                <div
                  key={item.catalogItemId}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] items-end gap-2 py-2"
                >
                  <div className="min-w-0 self-center">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="font-mono text-muted-foreground">
                      {item.code} · {formatMoney(item.unitPrice, currency)}
                    </p>
                  </div>
                  <label className="grid gap-1">
                    <span className="text-muted-foreground">Qty</span>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={item.qty}
                      disabled={mutation.isPending}
                      onChange={(event) => {
                        const qty = Number(event.target.value);
                        if (!Number.isInteger(qty) || qty < 1 || qty > 999) return;
                        setSelected(
                          selected.map((line) =>
                            line.catalogItemId === item.catalogItemId ? { ...line, qty } : line,
                          ),
                        );
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={mutation.isPending}
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      setSelected(
                        selected.filter((line) => line.catalogItemId !== item.catalogItemId),
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <SubmitButton isSubmitting={mutation.isPending} disabled={selected.length === 0}>
              Add {selected.length > 1 ? `${selected.length} charges` : "charge"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidChargeDialog({
  charge,
  orgSlug,
  appointmentId,
  onClose,
}: {
  charge: { id: string; description: string };
  orgSlug: string;
  appointmentId: string;
  onClose: () => void;
}) {
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const form = useZodForm(voidSchema, { defaultValues: { reason: "" } });
  const mutation = useMutation(
    orpc.billing.voidCharge.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Charge voided");
        onClose();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void charge</DialogTitle>
          <DialogDescription>{charge.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((value) =>
              mutation.mutate({ orgSlug, chargeId: charge.id, reason: value.reason }),
            )}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Void charge</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function IssueInvoiceDialog({
  open,
  onOpenChange,
  orgSlug,
  appointmentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  appointmentId: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = useBillingInvalidation(orgSlug, appointmentId);
  const form = useZodForm(invoiceSchema, {
    defaultValues: { discountAmount: "0", note: "" },
  });
  const mutation = useMutation(
    orpc.billing.issueInvoice.mutationOptions({
      onSuccess: async ({ invoice }) => {
        await invalidate(invoice.id);
        toast.success(`Invoice ${invoice.invoiceNumber} issued`);
        onOpenChange(false);
      },
      onError: (error) => {
        const raced =
          "Another terminal already issued this invoice — refreshed to the current state.";
        if (toastOpdConflict(queryClient, error, orgSlug, appointmentId, "billing", raced)) return;
        toast.error(error.message);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue invoice</DialogTitle>
          <DialogDescription>Pending charges become an immutable invoice.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((value) =>
              mutation.mutate({
                orgSlug,
                appointmentId,
                discountAmount: value.discountAmount,
                note: value.note || undefined,
              }),
            )}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="discountAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount amount</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={mutation.isPending} />
                  </FormControl>
                  <FormDescription>
                    Why this invoice looks the way it does. Staff only — it is not printed.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Issue invoice</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
