import { parseDecimal } from "@hms/api/core/money";
import { exactToPaise } from "@hms/api/core/receipt-math";
import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Form } from "@hms/ui/components/form";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type Control, useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { TextField } from "@/components/form-fields";
import { NewProductSheet } from "@/components/pharmacy-new-product-sheet";
import { PageBody, PageHeader } from "@/components/page";
import { BatchLines } from "@/components/receipt-batch-lines";
import {
  blankLine,
  fillLine,
  type Receipt,
  type ReceiptInput,
  receiptSchema,
  rowText,
} from "@/components/receipt-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orgToday, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { billSummary, stockQuantities } from "@/lib/receipt-lines";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/pharmacy/receive")({
  head: () => ({ meta: [{ title: "Receive goods · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { pharmacy: ["receive"] },
      "/$orgSlug/pharmacy",
    );
  },
  component: ReceiveGoodsRoute,
});

function ReceiveGoodsRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const { timeZone, today } = useOrgDateTime();
  const canManageItems = useCan(orgSlug, { pharmacy: ["manageItems"] });
  const schema = useMemo(() => receiptSchema(today), [today]);

  const form = useZodForm(schema, {
    defaultValues: {
      opening: false,
      supplierName: "",
      supplierReference: "",
      receivedOn: orgToday(timeZone),
      billTotal: "",
      note: "",
      lines: [blankLine()],
    },
  });

  const [newProductLine, setNewProductLine] = useState<number | null>(null);
  const opening = useWatch({ control: form.control, name: "opening" });

  const receive = useMutation(
    orpc.pharmacy.receiveGoods.mutationOptions({
      onSuccess: async (_data, variables) => {
        toast.success(
          variables.lines.length === 1
            ? "1 batch received"
            : `${variables.lines.length} batches received`,
        );
        await navigate({
          to: "/$orgSlug/pharmacy/stock",
          params: { orgSlug },
          ignoreBlocker: true,
        });
      },
    }),
  );

  const locked = receive.isPending;

  const submit = form.handleSubmit((values: Receipt) => {
    receive.mutate({
      orgSlug,
      opening: values.opening,
      supplierName: values.opening ? undefined : values.supplierName,
      supplierReference: values.opening ? undefined : values.supplierReference || undefined,
      receivedOn: values.receivedOn,
      billTotal: values.opening ? undefined : parseDecimal(values.billTotal),
      note: values.note || undefined,
      lines: values.lines.map((line) => {
        const row = rowText(line);
        const quantities = stockQuantities(row, values.opening);

        if (!quantities) throw new Error("A validated receipt line exceeds stock limits");

        return {
          productId: line.productId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          qty: quantities.qty,
          pricedPer: quantities.packSize === 1 ? ("unit" as const) : ("pack" as const),
          mrp: parseDecimal(line.price),
          cost: values.opening
            ? undefined
            : {
                freeQty: quantities.freeQty,
                rate: parseDecimal(line.rate),
                discountPercent: line.discount,
                gstPercent: line.gst,
                hsnCode: line.hsn || undefined,
              },
        };
      }),
    });
  });

  return (
    <>
      <PageHeader
        title="Receive goods"
        action={
          <Button
            variant="outline"
            nativeButton={false}
            disabled={locked}
            render={<Link to="/$orgSlug/pharmacy/stock" params={{ orgSlug }} />}
          >
            Back to stock
          </Button>
        }
      />

      <PageBody width="max-w-6xl">
        <Form {...form}>
          <form noValidate className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
            <fieldset disabled={locked} className="contents">
              <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 id="delivery-heading" className="text-sm font-medium">
                      Delivery details
                    </h2>
                    <p className="text-muted-foreground">
                      {opening
                        ? "Enter each batch you counted on the shelf."
                        : "Work down the supplier bill. Use one line for each product and batch."}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Receive as"
                    className="flex w-fit gap-1 rounded-md border border-border p-1"
                  >
                    {[
                      { label: "Supplier", value: false },
                      { label: "Opening", value: true },
                    ].map((mode) => (
                      <Button
                        key={mode.label}
                        type="button"
                        size="xs"
                        variant={opening === mode.value ? "default" : "ghost"}
                        aria-pressed={opening === mode.value}
                        onClick={() =>
                          form.setValue("opening", mode.value, {
                            shouldDirty: true,
                          })
                        }
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {opening ? null : (
                    <>
                      <TextField name="supplierName" label="Supplier" placeholder="Supplier name" />
                      <TextField
                        name="supplierReference"
                        label="Bill number"
                        placeholder="Bill number"
                      />
                      <TextField
                        name="billTotal"
                        label="Bill total"
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </>
                  )}
                  <TextField
                    name="receivedOn"
                    label={opening ? "Counted on" : "Received on"}
                    type="date"
                  />
                </div>
              </section>

              <BatchLines
                orgSlug={orgSlug}
                today={today}
                opening={opening}
                canManageItems={canManageItems}
                onNewProduct={setNewProductLine}
              />

              <div className="grid gap-4 lg:grid-cols-[minmax(0,36rem)_1fr]">
                <TextField
                  name="note"
                  label="Note (optional)"
                  placeholder="Optional note for the stock team"
                  multiline
                  className="[&_textarea]:min-h-20"
                />
                <div className="flex flex-wrap items-end justify-between gap-3 lg:flex-col lg:justify-end">
                  <ReceiptTotals orgSlug={orgSlug} opening={opening} />
                  <SubmitButton isSubmitting={locked}>Receive goods</SubmitButton>
                </div>
              </div>
            </fieldset>
          </form>
        </Form>
      </PageBody>

      {newProductLine !== null ? (
        <NewProductSheet
          orgSlug={orgSlug}
          onClose={() => setNewProductLine(null)}
          onAdded={(product) => {
            fillLine(form, newProductLine, product);
            setNewProductLine(null);
          }}
        />
      ) : null}

      <LeaveGuard control={form.control} locked={locked} />
    </>
  );
}

/** Reads `isDirty` here, so a dirty change never re-renders the page and its rows. */
function LeaveGuard({
  control,
  locked,
}: {
  control: Control<ReceiptInput, unknown, Receipt>;
  locked: boolean;
}) {
  const { isDirty } = useFormState({ control });

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty || locked,
    enableBeforeUnload: isDirty || locked,
    withResolver: true,
  });

  return blocker.status === "blocked" && !locked ? (
    <ConfirmDialog
      title="Leave without receiving these goods?"
      description="The receipt has not been saved."
      confirmLabel="Leave"
      open
      onConfirm={blocker.proceed}
      onCancel={blocker.reset}
    />
  ) : null;
}

/** Stock added, and on a delivery the bill arithmetic checked against its printed total. */
function ReceiptTotals({ orgSlug, opening }: { orgSlug: string; opening: boolean }) {
  const { control } = useFormContext<ReceiptInput, unknown, Receipt>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const [lines, billTotal] = useWatch({
    control,
    name: ["lines", "billTotal"],
  });

  let quantity = 0;

  for (const line of lines) {
    const quantities = stockQuantities(rowText(line), opening);
    quantity += quantities ? quantities.qty + quantities.freeQty : 0;
  }

  const summary = opening ? null : billSummary(lines.map(rowText), billTotal);

  return (
    <div className="flex flex-col gap-1 tabular-nums lg:items-end lg:text-right">
      <p className="font-medium">
        {lines.length} batch{lines.length === 1 ? "" : "es"} · {quantity} stock unit
        {quantity === 1 ? "" : "s"}
      </p>
      {summary ? (
        <>
          <p className="text-muted-foreground">
            Taxable {formatMoney(exactToPaise(summary.taxable), currency)} · GST{" "}
            {formatMoney(exactToPaise(summary.gst), currency)} · Lines{" "}
            {formatMoney(summary.net, currency)}
          </p>
          {summary.roundOff === null ? (
            <p className="text-muted-foreground">
              {summary.complete
                ? "Enter the bill total to check it"
                : "Price every line to check the bill"}
            </p>
          ) : (
            <p
              className="flex flex-wrap items-center gap-2 lg:justify-end"
              role={summary.matches ? undefined : "alert"}
            >
              <Badge variant={summary.matches ? "muted" : "destructive"}>
                {summary.matches ? "Matches bill" : "Does not match bill"}
              </Badge>
              <span className={summary.matches ? "text-muted-foreground" : "text-destructive"}>
                {summary.matches ? "Round-off" : "Off by"} {formatMoney(summary.roundOff, currency)}
              </span>
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
