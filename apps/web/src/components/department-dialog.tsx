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
import { optionalText } from "@/lib/form-schema";
import { orpc } from "@/lib/orpc";

const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a department name")
    .max(200, "Keep the name under 200 characters"),
  defaultConsultFeeItemId: optionalText(z.string()),
});

export type Department = {
  id: string;
  name: string;
  defaultConsultFeeItemId: string | null;
  createdAt: Date | string;
};

export type CatalogOption = {
  id: string;
  name: string;
  code: string;
};

export function DepartmentDialog({
  department,
  orgSlug,
  catalogItems,
  catalogPending,
  catalogFooter,
  onClose,
}: {
  department?: Department;
  orgSlug: string;
  catalogItems: CatalogOption[];
  catalogPending: boolean;
  catalogFooter: ReactNode;
  onClose: () => void;
}) {
  const form = useZodForm(departmentSchema, {
    defaultValues: {
      name: department?.name ?? "",
      defaultConsultFeeItemId: department?.defaultConsultFeeItemId ?? "",
    },
  });

  const mutationFeedback = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
  });

  const createDepartment = useMutation(
    orpc.staff.createDepartment.mutationOptions(mutationFeedback("Department created")),
  );

  const updateDepartment = useMutation(
    orpc.staff.updateDepartment.mutationOptions(mutationFeedback("Department updated")),
  );

  const isSubmitting = createDepartment.isPending || updateDepartment.isPending;

  const submit = form.handleSubmit((values) => {
    if (department) {
      updateDepartment.mutate({ orgSlug, departmentId: department.id, ...values });
    } else {
      createDepartment.mutate({ orgSlug, ...values });
    }
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? "Edit department" : "New department"}</DialogTitle>
          {!department ? (
            <DialogDescription>
              Departments group practitioners and set a default consult fee
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <TextField name="name" label="Name" autoFocus disabled={isSubmitting} />
            {/* Controlled, not registered: the catalog arrives from a query,
                and a stored id with no matching <option> yet would be lost. */}
            <ControlledField
              name="defaultConsultFeeItemId"
              label="Default consult fee (optional)"
              render={(field) => (
                <FormControl>
                  <OptionCombobox
                    {...field}
                    options={[
                      { value: "", label: "None" },
                      ...catalogItems.map((item) => ({
                        value: item.id,
                        label: `${item.name} (${item.code})`,
                      })),
                    ]}
                    disabled={isSubmitting || catalogPending}
                  />
                </FormControl>
              )}
            />
            {catalogFooter}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={isSubmitting}>
                {department ? "Save changes" : "Create department"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
