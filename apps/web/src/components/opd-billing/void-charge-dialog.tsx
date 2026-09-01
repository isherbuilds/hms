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
  RegisteredFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

import { useBillingInvalidation } from "./use-billing-invalidation";

const voidSchema = z.object({ reason: z.string().trim().min(1, "Enter a reason").max(500) });

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
      onSuccess: () => {
        onClose();
        toast.success("Charge voided");
        void invalidate();
      },
      onError: (error) => toast.error(errorMessage(error, "Could not void the charge")),
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
            <RegisteredFormField
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
              <SubmitButton isSubmitting={mutation.isPending}>Void charge</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
