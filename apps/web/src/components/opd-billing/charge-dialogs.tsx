import { Button } from "@hms/ui/components/button";
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
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { formatMoney, MONEY_INPUT_PATTERN } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { toastOpdConflict } from "@/lib/opd-operational-query";

import { useBillingInvalidation } from "./use-billing-invalidation";

const addChargeSchema = z.object({
  catalogItemId: z.string().min(1, "Choose a catalog item"),
  qty: z.number().int().min(1, "Quantity from 1 to 999").max(999, "Quantity from 1 to 999"),
});

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
  const catalog = useQuery(
    orpc.catalog.list.queryOptions({ input: { orgSlug, activeOnly: true } }),
  );
  const form = useZodForm(addChargeSchema, {
    defaultValues: {
      catalogItemId: "",
      qty: 1,
    },
  });
  const mutation = useMutation(
    orpc.billing.addCharge.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Charge added");
        onOpenChange(false);
        form.reset();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit((value) =>
    mutation.mutate({ orgSlug, appointmentId, ...value }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add charge</DialogTitle>
          <DialogDescription>
            Add an active service from the organization catalog.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="catalogItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catalog item</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending || catalog.isPending}>
                      <option value="">Choose an item</option>
                      {(catalog.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {formatMoney(item.unitPrice, currency)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      {...field}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Add charge</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
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
