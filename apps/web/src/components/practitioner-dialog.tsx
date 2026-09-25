import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { FormControl, Form } from "@hms/ui/components/form";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ControlledField, TextField } from "@/components/form-fields";
import { OptionCombobox } from "@/components/option-combobox";
import { useZodForm } from "@/hooks/use-zod-form";
import { optionalNumberText, optionalText } from "@/lib/form-schema";
import { orpc } from "@/lib/orpc";

import type { CatalogOption, Department } from "./department-dialog";

const practitionerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a practitioner name")
    .max(200, "Keep the name under 200 characters"),
  departmentId: z.string().min(1, "Choose a department"),
  registrationNumber: optionalText(z.string()),
  memberUserId: optionalText(z.string()),
  consultFeeItemId: optionalText(z.string()),
  followUpFeeItemId: optionalText(z.string()),
  followUpValidityDays: optionalNumberText(
    z.number().int().min(1, "Between 1 and 365 days").max(365, "Between 1 and 365 days"),
  ),
});

export type Practitioner = {
  id: string;
  name: string;
  departmentId: string;
  registrationNumber: string | null;
  memberUserId: string | null;
  consultFeeItemId: string | null;
  followUpFeeItemId: string | null;
  followUpValidityDays: number | null;
};

type MemberOption = {
  userId: string;
  name: string;
  email: string;
};

const NONE = { value: "", label: "None" };

export function PractitionerDialog({
  practitioner,
  orgSlug,
  departments,
  members,
  catalogItems,
  membersPending,
  catalogPending,
  catalogFooter,
  onClose,
}: {
  practitioner?: Practitioner;
  orgSlug: string;
  departments: Department[];
  members: MemberOption[];
  catalogItems: CatalogOption[];
  membersPending: boolean;
  catalogPending: boolean;
  catalogFooter: ReactNode;
  onClose: () => void;
}) {
  const form = useZodForm(practitionerSchema, {
    defaultValues: {
      name: practitioner?.name ?? "",
      departmentId: practitioner?.departmentId ?? departments[0]?.id ?? "",
      registrationNumber: practitioner?.registrationNumber ?? "",
      memberUserId: practitioner?.memberUserId ?? "",
      consultFeeItemId: practitioner?.consultFeeItemId ?? "",
      followUpFeeItemId: practitioner?.followUpFeeItemId ?? "",
      followUpValidityDays: practitioner?.followUpValidityDays?.toString() ?? "",
    },
  });

  const feeOptions = [
    NONE,
    ...catalogItems.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` })),
  ];

  const mutationFeedback = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
  });

  const createPractitioner = useMutation(
    orpc.staff.createPractitioner.mutationOptions(mutationFeedback("Practitioner created")),
  );

  const updatePractitioner = useMutation(
    orpc.staff.updatePractitioner.mutationOptions(mutationFeedback("Practitioner updated")),
  );

  const isSubmitting = createPractitioner.isPending || updatePractitioner.isPending;

  const submit = form.handleSubmit((values) => {
    if (practitioner) {
      updatePractitioner.mutate({ orgSlug, practitionerId: practitioner.id, ...values });
    } else {
      createPractitioner.mutate({ orgSlug, ...values });
    }
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{practitioner ? "Edit practitioner" : "New practitioner"}</DialogTitle>
          <DialogDescription>
            Assign the practitioner to a department and optionally link their login and consultation
            fee.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="name" label="Name" autoFocus disabled={isSubmitting} />
              <ControlledField
                name="departmentId"
                label="Department"
                render={(field) => (
                  <FormControl>
                    <OptionCombobox
                      {...field}
                      options={departments.map((department) => ({
                        value: department.id,
                        label: department.name,
                      }))}
                      placeholder="Choose a department"
                      disabled={isSubmitting}
                    />
                  </FormControl>
                )}
              />
            </div>

            <TextField
              name="registrationNumber"
              label="Registration no. (optional)"
              disabled={isSubmitting}
            />

            <ControlledField
              name="memberUserId"
              label="Linked member (optional)"
              render={(field) => (
                <FormControl>
                  <OptionCombobox
                    {...field}
                    options={[
                      NONE,
                      ...members.map((member) => ({
                        value: member.userId,
                        label: `${member.name} — ${member.email}`,
                      })),
                    ]}
                    disabled={isSubmitting || membersPending}
                  />
                </FormControl>
              )}
            />

            <ControlledField
              name="consultFeeItemId"
              label="Consult fee item (optional)"
              render={(field) => (
                <FormControl>
                  <OptionCombobox
                    {...field}
                    options={feeOptions}
                    disabled={isSubmitting || catalogPending}
                  />
                </FormControl>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlledField
                name="followUpFeeItemId"
                label="Follow-up fee (optional)"
                render={(field) => (
                  <FormControl>
                    <OptionCombobox
                      {...field}
                      options={feeOptions}
                      disabled={isSubmitting || catalogPending}
                    />
                  </FormControl>
                )}
              />
              <TextField
                name="followUpValidityDays"
                label="Follow-up window (days)"
                type="number"
                min={1}
                max={365}
                step={1}
                placeholder="Organization default"
                disabled={isSubmitting}
              />
            </div>
            {catalogFooter}

            <DialogFooter>
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={isSubmitting}>
                {practitioner ? "Save changes" : "Create practitioner"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
