import { authorize } from "@hms/auth/access";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { UseFormReturn } from "react-hook-form";
import { useState, type FormEventHandler, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { LastUpdated } from "@/components/last-updated";
import { PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { refreshVisitOnConflict } from "@/lib/visit-operational-query";

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const RATE = /^\d{1,2}(\.\d{1,2})?$/;
const addChargeSchema = z
  .object({
    mode: z.enum(["catalog", "manual"]),
    catalogItemId: z.string(),
    qty: z.number().int().min(1, "Quantity from 1 to 999").max(999, "Quantity from 1 to 999"),
    description: z.string().trim().max(500),
    unitPrice: z.string(),
    taxRatePercent: z.string(),
    taxCode: z.string().trim().max(30).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "catalog" && !value.catalogItemId) {
      context.addIssue({
        code: "custom",
        path: ["catalogItemId"],
        message: "Choose a catalog item",
      });
    }
    if (value.mode === "manual") {
      if (!value.description)
        context.addIssue({ code: "custom", path: ["description"], message: "Enter a description" });
      if (!MONEY.test(value.unitPrice))
        context.addIssue({ code: "custom", path: ["unitPrice"], message: "Amount like 150.00" });
      if (!RATE.test(value.taxRatePercent) || Number(value.taxRatePercent) > 99.99) {
        context.addIssue({
          code: "custom",
          path: ["taxRatePercent"],
          message: "Rate from 0 to 99.99",
        });
      }
    }
  });
const voidSchema = z.object({ reason: z.string().trim().min(1, "Enter a reason").max(500) });
const invoiceSchema = z
  .object({
    discountAmount: z.string().regex(MONEY, "Amount like 0 or 50.00"),
    discountReason: z.string().trim().max(500).optional(),
  })
  .refine((value) => Number(value.discountAmount) <= 0 || Boolean(value.discountReason), {
    path: ["discountReason"],
    message: "A reason is required when applying a discount",
  });
const paymentSchema = z.object({
  method: z.enum(["cash", "upi", "card"]),
  amount: z
    .string()
    .regex(MONEY, "Amount like 150.00")
    .refine((value) => Number(value) > 0, "Enter an amount above zero"),
  reference: z.string().trim().max(100).optional(),
});
const refundSchema = paymentSchema.extend({
  creditNoteId: z.string().min(1, "Choose a credit note"),
});
const creditSchema = z
  .object({
    reason: z.string().trim().min(1, "Enter a reason").max(500),
    lines: z.array(
      z.object({ invoiceLineId: z.string(), full: z.boolean(), gross: z.string().optional() }),
    ),
  })
  .superRefine((value, context) => {
    if (
      !value.lines.some(
        (line) => line.full || (line.gross && MONEY.test(line.gross) && Number(line.gross) > 0),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Credit at least one full line or partial amount",
      });
    }
    value.lines.forEach((line, index) => {
      if (!line.full && line.gross && (!MONEY.test(line.gross) || Number(line.gross) <= 0)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "gross"],
          message: "Enter an amount above zero",
        });
      }
    });
  });
type AddChargeForm = UseFormReturn<
  z.input<typeof addChargeSchema>,
  unknown,
  z.output<typeof addChargeSchema>
>;
type PaymentForm = UseFormReturn<
  z.input<typeof paymentSchema>,
  unknown,
  z.output<typeof paymentSchema>
>;

export const Route = createFileRoute("/org/$orgSlug/billing/visits/$visitId")({
  loader: ({ context: { queryClient }, params: { orgSlug, visitId } }) => {
    void Promise.all([
      queryClient.prefetchQuery(orpc.visit.get.queryOptions({ input: { orgSlug, visitId } })),
      queryClient.prefetchQuery(
        orpc.billing.listPendingCharges.queryOptions({ input: { orgSlug, visitId } }),
      ),
      queryClient.prefetchQuery(
        orpc.billing.listInvoices.queryOptions({ input: { orgSlug, visitId } }),
      ),
    ]);
  },
  component: BillingVisitRoute,
});

function BillingVisitRoute() {
  const { orgSlug, visitId } = Route.useParams();
  const [addOpen, setAddOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; description: string } | null>(null);
  const detailQuery = {
    ...orpc.visit.get.queryOptions({ input: { orgSlug, visitId } }),
    ...OPERATIONAL_REFETCH,
  };
  const detail = useQuery(detailQuery);
  const pendingQuery = {
    ...orpc.billing.listPendingCharges.queryOptions({ input: { orgSlug, visitId } }),
    ...OPERATIONAL_REFETCH,
  };
  const pending = useQuery(pendingQuery);
  const invoicesQuery = {
    ...orpc.billing.listInvoices.queryOptions({ input: { orgSlug, visitId } }),
    ...OPERATIONAL_REFETCH,
  };
  const invoices = useQuery(invoicesQuery);
  const membership = useQuery(orpc.members.me.queryOptions({ input: { orgSlug } }));
  const canCredit = membership.data?.roles
    ? authorize(membership.data.roles, { billing: ["creditNote"] })
    : false;

  if (detail.isPending || pending.isPending || invoices.isPending) {
    return (
      <>
        <PageHeader title="Billing workspace" description="Visit account" />
        <div
          className="m-4 border border-dashed p-8 text-center text-xs text-muted-foreground"
          aria-busy
        >
          Loading billing workspace…
        </div>
      </>
    );
  }
  if (detail.isError || pending.isError || invoices.isError) {
    const error = detail.error ?? pending.error ?? invoices.error;
    return (
      <>
        <PageHeader title="Billing workspace" description="Visit account" />
        <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
          <p className="font-medium">Could not load billing workspace</p>
          <p className="text-muted-foreground">{error?.message}</p>
        </div>
      </>
    );
  }

  const { visit, patient, practitioner } = detail.data;
  return (
    <>
      <PageHeader
        title={`Billing · Token ${visit.tokenNumber}`}
        description={`${patient.name} · ${patient.mrn}`}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <LastUpdated
              queryKeys={[detailQuery.queryKey, pendingQuery.queryKey, invoicesQuery.queryKey]}
            />
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Add charge
            </Button>
            <Button
              size="sm"
              disabled={pending.data.length === 0}
              onClick={() => setInvoiceOpen(true)}
            >
              Issue invoice
            </Button>
          </div>
        }
      />
      <PageBody className="max-w-7xl">
        <section className="grid gap-px bg-border ring-1 ring-border sm:grid-cols-4">
          <Detail label="Patient">
            <p className="font-medium">{patient.name}</p>
            <p className="text-muted-foreground">
              {patient.mrn} · {patient.phone}
            </p>
          </Detail>
          <Detail label="Practitioner">{practitioner.name}</Detail>
          <Detail label="Status">
            <Badge variant="secondary">{visit.status.replace("_", " ")}</Badge>
          </Detail>
          <Detail label="Token">
            <span className="text-xl font-semibold tabular-nums">{visit.tokenNumber}</span>
          </Detail>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Pending charges</h2>
          <div className="overflow-x-auto ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No pending charges.
                    </TableCell>
                  </TableRow>
                ) : (
                  pending.data.map((charge) => (
                    <TableRow key={charge.id}>
                      <TableCell className="font-medium">{charge.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{charge.unitPrice}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setVoiding({ id: charge.id, description: charge.description })
                          }
                        >
                          Void
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Invoices</h2>
          {invoices.data.length === 0 ? (
            <div className="border border-dashed px-4 py-8 text-center text-muted-foreground">
              No invoices issued for this visit.
            </div>
          ) : (
            invoices.data.map((invoice) => (
              <InvoiceAccount
                key={invoice.id}
                orgSlug={orgSlug}
                visitId={visitId}
                invoice={invoice}
                canCredit={canCredit}
              />
            ))
          )}
        </section>
      </PageBody>
      <AddChargeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgSlug={orgSlug}
        visitId={visitId}
      />
      <IssueInvoiceDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        orgSlug={orgSlug}
        visitId={visitId}
      />
      {voiding ? (
        <VoidChargeDialog
          charge={voiding}
          orgSlug={orgSlug}
          visitId={visitId}
          onClose={() => setVoiding(null)}
        />
      ) : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-background p-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function useBillingInvalidation(orgSlug: string, visitId: string) {
  const queryClient = useQueryClient();
  return (invoiceId?: string) =>
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.billing.listPendingCharges.key({ input: { orgSlug, visitId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.billing.listInvoices.key({ input: { orgSlug, visitId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.visit.get.key({ input: { orgSlug, visitId } }),
      }),
      ...(invoiceId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.billing.getInvoice.key({ input: { orgSlug, invoiceId } }),
            }),
          ]
        : []),
    ]);
}

function AddChargeDialog({
  open,
  onOpenChange,
  orgSlug,
  visitId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  visitId: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const catalog = useQuery(
    orpc.catalog.list.queryOptions({ input: { orgSlug, activeOnly: true } }),
  );
  const form = useZodForm(addChargeSchema, {
    defaultValues: {
      mode: "catalog",
      catalogItemId: "",
      qty: 1,
      description: "",
      unitPrice: "",
      taxRatePercent: "0",
      taxCode: "",
    },
  });
  const mode = form.watch("mode");
  const mutation = useMutation(
    orpc.billing.addCharge.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Charge added");
        onOpenChange(false);
        form.reset();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit((value) =>
    mutation.mutate(
      value.mode === "catalog"
        ? { orgSlug, visitId, qty: value.qty, catalogItemId: value.catalogItemId }
        : {
            orgSlug,
            visitId,
            qty: value.qty,
            description: value.description,
            unitPrice: value.unitPrice,
            taxRatePercent: value.taxRatePercent,
            taxCode: value.taxCode || undefined,
          },
    ),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add charge</DialogTitle>
          <DialogDescription>
            Add an active catalog service or a sanctioned manual charge.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Charge type</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending}>
                      <option value="catalog">Catalog</option>
                      <option value="manual">Manual</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {mode === "catalog" ? (
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
                            {item.name} · {item.unitPrice}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={mutation.isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <MoneyField
                  form={form}
                  name="unitPrice"
                  label="Unit price"
                  pending={mutation.isPending}
                />
                <MoneyField
                  form={form}
                  name="taxRatePercent"
                  label="Tax rate %"
                  pending={mutation.isPending}
                />
                <FormField
                  control={form.control}
                  name="taxCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax code</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={mutation.isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
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

function MoneyField({
  form,
  name,
  label,
  pending,
}: {
  form: AddChargeForm;
  name: "unitPrice" | "taxRatePercent";
  label: string;
  pending: boolean;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} inputMode="decimal" disabled={pending} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function VoidChargeDialog({
  charge,
  orgSlug,
  visitId,
  onClose,
}: {
  charge: { id: string; description: string };
  orgSlug: string;
  visitId: string;
  onClose: () => void;
}) {
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const form = useZodForm(voidSchema, { defaultValues: { reason: "" } });
  const mutation = useMutation(
    orpc.billing.voidCharge.mutationOptions({
      onSuccess: () => {
        invalidate();
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

function IssueInvoiceDialog({
  open,
  onOpenChange,
  orgSlug,
  visitId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  visitId: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const form = useZodForm(invoiceSchema, {
    defaultValues: { discountAmount: "0", discountReason: "" },
  });
  const mutation = useMutation(
    orpc.billing.issueInvoice.mutationOptions({
      onSuccess: ({ invoice }) => {
        invalidate(invoice.id);
        toast.success(`Invoice ${invoice.invoiceNumber} issued`);
        onOpenChange(false);
      },
      onError: (error) => {
        if (refreshVisitOnConflict(queryClient, error, orgSlug, visitId)) {
          toast.error(
            "Another terminal already issued this invoice — refreshed to the current state.",
          );
          return;
        }
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
                visitId,
                discountAmount: value.discountAmount,
                discountReason: value.discountReason || undefined,
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
              name="discountReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={mutation.isPending} />
                  </FormControl>
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

type InvoiceHeader = {
  id: string;
  invoiceNumber: string;
  grandTotal: string;
  creditTotal: string;
  paymentsTotal: string;
  refundsTotal: string;
  outstanding: string;
};
function InvoiceAccount({
  orgSlug,
  visitId,
  invoice,
  canCredit,
}: {
  orgSlug: string;
  visitId: string;
  invoice: InvoiceHeader;
  canCredit: boolean;
}) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const detail = useQuery(
    orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId: invoice.id } }),
  );
  const positive = Number(invoice.outstanding) > 0;
  return (
    <div className="flex flex-col gap-2 border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to="/org/$orgSlug/billing/invoices/$invoiceId"
            params={{ orgSlug, invoiceId: invoice.id }}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {invoice.invoiceNumber}
          </Link>
          <p className="text-muted-foreground">
            Total {invoice.grandTotal} · Paid {invoice.paymentsTotal}
          </p>
          <p
            className={
              Number(invoice.outstanding) < 0 ? "font-medium text-destructive" : "font-medium"
            }
          >
            {Number(invoice.outstanding) < 0
              ? `Refund due ${Math.abs(Number(invoice.outstanding)).toFixed(2)}`
              : `Outstanding ${invoice.outstanding}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={!positive}
            onClick={() => setPaymentOpen(true)}
          >
            Record payment
          </Button>
          {canCredit ? (
            <>
              <Button size="xs" variant="outline" onClick={() => setCreditOpen(true)}>
                Credit note
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!detail.data?.creditNotes.length || Number(invoice.outstanding) >= 0}
                onClick={() => setRefundOpen(true)}
              >
                Record refund
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {detail.data ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <Link
            to="/org/$orgSlug/billing/invoices/$invoiceId"
            params={{ orgSlug, invoiceId: invoice.id }}
            search={{ layout: undefined }}
          >
            Invoice print
          </Link>
          {detail.data.payments.map((payment) => (
            <Link
              key={payment.id}
              to="/org/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId"
              params={{ orgSlug, invoiceId: invoice.id, paymentId: payment.id }}
            >
              Receipt {payment.receiptNumber}
            </Link>
          ))}
          {detail.data.creditNotes.map((note) => (
            <Link
              key={note.id}
              to="/org/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId"
              params={{ orgSlug, invoiceId: invoice.id, creditNoteId: note.id }}
            >
              {note.creditNoteNumber}
            </Link>
          ))}
          {detail.data.refunds.map((refund) => (
            <Link
              key={refund.id}
              to="/org/$orgSlug/billing/invoices/$invoiceId/refund/$refundId"
              params={{ orgSlug, invoiceId: invoice.id, refundId: refund.id }}
            >
              {refund.refundNumber}
            </Link>
          ))}
        </div>
      ) : null}
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        orgSlug={orgSlug}
        visitId={visitId}
        invoiceId={invoice.id}
      />
      {detail.data ? (
        <CreditDialog
          open={creditOpen}
          onOpenChange={setCreditOpen}
          orgSlug={orgSlug}
          visitId={visitId}
          invoiceId={invoice.id}
          lines={detail.data.lines}
        />
      ) : null}
      {detail.data ? (
        <RefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          orgSlug={orgSlug}
          visitId={visitId}
          invoiceId={invoice.id}
          creditNotes={detail.data.creditNotes}
        />
      ) : null}
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  orgSlug,
  visitId,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  visitId: string;
  invoiceId: string;
}) {
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const form = useZodForm(paymentSchema, {
    defaultValues: { method: "cash", amount: "", reference: "" },
  });
  const mutation = useMutation(
    orpc.billing.recordPayment.mutationOptions({
      onSuccess: () => {
        invalidate(invoiceId);
        toast.success("Payment recorded");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <MoneyActionDialog
      title="Record payment"
      description="Record funds received against this invoice."
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      pending={mutation.isPending}
      submitLabel="Record payment"
      onSubmit={form.handleSubmit((value) =>
        mutation.mutate({
          orgSlug,
          invoiceId,
          method: value.method,
          amount: value.amount,
          reference: value.reference || undefined,
        }),
      )}
    />
  );
}

function CreditDialog({
  open,
  onOpenChange,
  orgSlug,
  visitId,
  invoiceId,
  lines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  visitId: string;
  invoiceId: string;
  lines: Array<{ id: string; description: string; gross: string }>;
}) {
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const form = useZodForm(creditSchema, {
    defaultValues: {
      reason: "",
      lines: lines.map((line) => ({ invoiceLineId: line.id, full: false, gross: "" })),
    },
  });
  const mutation = useMutation(
    orpc.billing.issueCreditNote.mutationOptions({
      onSuccess: () => {
        invalidate(invoiceId);
        toast.success("Credit note issued");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit((value) =>
    mutation.mutate({
      orgSlug,
      invoiceId,
      reason: value.reason,
      lines: value.lines
        .filter((line) => line.full || line.gross)
        .map((line) =>
          line.full
            ? { invoiceLineId: line.invoiceLineId, full: true as const }
            : { invoiceLineId: line.invoiceLineId, gross: line.gross! },
        ),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue credit note</DialogTitle>
          <DialogDescription>Select full lines or enter a partial gross amount.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="overflow-x-auto ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Full</TableHead>
                    <TableHead>Partial gross</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{line.gross}</TableCell>
                      <TableCell>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.full`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.gross`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  inputMode="decimal"
                                  disabled={form.watch(`lines.${index}.full`)}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-destructive">{form.formState.errors.lines?.root?.message}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Issue credit note</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  orgSlug,
  visitId,
  invoiceId,
  creditNotes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  visitId: string;
  invoiceId: string;
  creditNotes: Array<{ id: string; creditNoteNumber: string; total: string }>;
}) {
  const invalidate = useBillingInvalidation(orgSlug, visitId);
  const form = useZodForm(refundSchema, {
    defaultValues: { creditNoteId: "", method: "cash", amount: "", reference: "" },
  });
  const mutation = useMutation(
    orpc.billing.recordRefund.mutationOptions({
      onSuccess: () => {
        invalidate(invoiceId);
        toast.success("Refund recorded");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record refund</DialogTitle>
          <DialogDescription>Return an available credit-note amount.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((value) =>
              mutation.mutate({
                orgSlug,
                creditNoteId: value.creditNoteId,
                method: value.method,
                amount: value.amount,
                reference: value.reference || undefined,
              }),
            )}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="creditNoteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit note</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">Choose a credit note</option>
                      {creditNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.creditNoteNumber} · {note.total}
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
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={mutation.isPending}>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={mutation.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={mutation.isPending}>Record refund</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function MoneyActionDialog({
  title,
  description,
  open,
  onOpenChange,
  form,
  pending,
  submitLabel,
  onSubmit,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: PaymentForm;
  pending: boolean;
  submitLabel: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <MoneyActionFields form={form} pending={pending} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={pending}>{submitLabel}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
function MoneyActionFields({ form, pending }: { form: PaymentForm; pending: boolean }) {
  return (
    <>
      <FormField
        control={form.control}
        name="method"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Method</FormLabel>
            <FormControl>
              <NativeSelect {...field} disabled={pending}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="amount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Amount</FormLabel>
            <FormControl>
              <Input {...field} inputMode="decimal" disabled={pending} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="reference"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Reference</FormLabel>
            <FormControl>
              <Input {...field} disabled={pending} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
