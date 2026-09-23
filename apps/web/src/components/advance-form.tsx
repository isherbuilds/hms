import { formatDecimal } from "@hms/api/core/money";
import { requirePaymentReference } from "@hms/api/lib/schemas";
import { Button } from "@hms/ui/components/button";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useState } from "react";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { PaymentLineFields } from "@/components/payment-lines";
import { advancePdfUrl } from "@/lib/billing-document";
import { orpc } from "@/lib/orpc";
import { paymentLineFields } from "@/lib/settlement";

const advanceSchema = paymentLineFields
  .extend({ treatmentPlanId: z.string(), note: z.string().trim().max(500).optional() })
  .superRefine(requirePaymentReference);

const refundSchema = paymentLineFields.superRefine(requirePaymentReference);

export function AdvanceReceiptLink({
  orgSlug,
  id,
  refundId,
  label,
}: {
  orgSlug: string;
  id: string;
  /** Prints the refund voucher issued against the receipt rather than the receipt. */
  refundId?: string;
  label: string;
}) {
  return (
    <a
      href={advancePdfUrl(orgSlug, id, refundId)}
      target="_blank"
      rel="noreferrer"
      className="relative font-mono underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
    >
      {label}
    </a>
  );
}

export function AdvanceForm({
  orgSlug,
  patientId,
  plans,
  linkedPlanId,
}: {
  orgSlug: string;
  patientId: string;
  plans: Array<{ id: string; label: string }>;
  /** The plan the current sitting is linked to. */
  linkedPlanId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Take advance
      </Button>
      {open ? (
        <TakeAdvanceDialog
          orgSlug={orgSlug}
          patientId={patientId}
          plans={plans}
          linkedPlanId={linkedPlanId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TakeAdvanceDialog({
  orgSlug,
  patientId,
  plans,
  linkedPlanId,
  onClose,
}: {
  orgSlug: string;
  patientId: string;
  plans: Array<{ id: string; label: string }>;
  linkedPlanId?: string;
  onClose: () => void;
}) {
  // The sitting's plan, else the patient's only open plan, else general patient credit.
  const defaultPlan =
    plans.find((plan) => plan.id === linkedPlanId) ?? (plans.length === 1 ? plans[0] : undefined);

  return (
    <FormDialog
      title="Take advance"
      description="Record money for future services without creating an invoice."
      submitLabel="Record advance"
      schema={advanceSchema}
      defaultValues={{
        treatmentPlanId: defaultPlan?.id ?? "",
        method: "cash",
        amount: "",
        reference: "",
        note: "",
      }}
      success="Advance receipt recorded"
      onClose={onClose}
      run={(values) =>
        orpc.billing.recordAdvance.call({
          orgSlug,
          patientId,
          treatmentPlanId: values.treatmentPlanId || undefined,
          method: values.method,
          amount: values.amount,
          reference: values.reference || undefined,
          note: values.note || undefined,
        })
      }
      done={(advance) => ({
        label: `Advance Receipt ${advance.receiptNumber}`,
        href: advancePdfUrl(orgSlug, advance.id),
        action: "Print receipt",
      })}
    >
      <ControlledField
        name="treatmentPlanId"
        label="Treatment plan"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              <option value="">Patient credit · future services</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <PaymentLineFields />
      <TextField name="note" label="Note" multiline />
    </FormDialog>
  );
}

export function AdvanceRefundDialog({
  orgSlug,
  receipt,
  onClose,
}: {
  orgSlug: string;
  /** The receipt as the desk saw it when it chose Refund. */
  receipt: { id: string; remaining: bigint };
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Refund advance"
      description="Return unused patient credit from this receipt."
      submitLabel="Record refund"
      schema={refundSchema}
      defaultValues={{ method: "cash", amount: formatDecimal(receipt.remaining), reference: "" }}
      success="Refund recorded"
      onClose={onClose}
      run={(value) =>
        orpc.billing.recordAdvanceRefund.call({
          orgSlug,
          advanceReceiptId: receipt.id,
          method: value.method,
          amount: value.amount,
          reference: value.reference || undefined,
        })
      }
      done={(recorded) => ({
        label: `Refund voucher ${recorded.refundNumber}`,
        href: advancePdfUrl(orgSlug, receipt.id, recorded.id),
        action: "Print voucher",
      })}
    >
      <PaymentLineFields />
    </FormDialog>
  );
}
