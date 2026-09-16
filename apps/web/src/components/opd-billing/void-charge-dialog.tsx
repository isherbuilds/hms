import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { orpc } from "@/lib/orpc";

const voidSchema = z.object({ reason: z.string().trim().min(1, "Enter a reason").max(500) });

export function VoidChargeDialog({
  charge,
  orgSlug,
  onClose,
}: {
  charge: { id: string; description: string };
  orgSlug: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Void charge"
      description={charge.description}
      submitLabel="Void charge"
      schema={voidSchema}
      defaultValues={{ reason: "" }}
      success="Charge voided"
      onClose={onClose}
      run={(value) =>
        orpc.billing.voidCharge.call({ orgSlug, chargeId: charge.id, reason: value.reason })
      }
    >
      <TextField name="reason" label="Reason" multiline />
    </FormDialog>
  );
}
