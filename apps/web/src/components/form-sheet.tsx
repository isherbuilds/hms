import { Button } from "@hms/ui/components/button";
import { Form } from "@hms/ui/components/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { DefaultValues, FieldValues } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { closeOnConflict } from "@/lib/orpc-error";

/** Mount per open; the fields scroll while the title and actions stay in reach. */
export function FormSheet<T extends z.ZodType<FieldValues, FieldValues>, R>({
  title,
  description,
  submitLabel,
  schema,
  defaultValues,
  success,
  run,
  onClose,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  schema: T;
  defaultValues: DefaultValues<z.input<T>>;
  success: string;
  run: (value: z.output<T>) => Promise<R>;
  onClose: () => void;
  children: ReactNode;
}) {
  const form = useZodForm(schema, { defaultValues });

  const submit = useMutation({
    mutationFn: run,
    onSuccess: () => {
      onClose();
      toast.success(success);
    },
    onError: closeOnConflict(onClose),
  });

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => (open || submit.isPending ? undefined : onClose())}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              noValidate
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={form.handleSubmit((value) => submit.mutate(value))}
            >
              <fieldset disabled={submit.isPending} className="contents">
                <div className="scroll-rule flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
                  {children}
                </div>
                <SheetFooter>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <SubmitButton isSubmitting={submit.isPending}>{submitLabel}</SubmitButton>
                </SheetFooter>
              </fieldset>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
