import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { Form } from "@hms/ui/components/form";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { DefaultValues, FieldValues } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { closeOnConflict } from "@/lib/orpc-error";

type Printed = { label: string; href: string; action: string };

/** A dialog that is one form and the single call it makes; mount it per open. */
export function FormDialog<T extends z.ZodType<FieldValues, FieldValues>, R>({
  title,
  description,
  submitLabel,
  schema,
  defaultValues,
  success,
  run,
  done,
  onClose,
  contentClassName,
  children,
}: {
  title: string;
  description: string;
  submitLabel: string;
  schema: T;
  defaultValues: DefaultValues<z.input<T>>;
  success: string;
  run: (value: z.output<T>) => Promise<R>;
  /** Keeps the dialog open on success, showing the document the call produced. */
  done?: (result: R) => Printed;
  onClose: () => void;
  contentClassName?: string;
  children: ReactNode;
}) {
  const form = useZodForm(schema, { defaultValues });

  const [printed, setPrinted] = useState<Printed | null>(null);

  const submit = useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      if (done) setPrinted(done(result));
      else onClose();
      toast.success(success);
    },
    onError: closeOnConflict(onClose),
  });

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className={contentClassName}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {printed ? (
            <div className="flex items-center justify-between gap-3">
              <p>{printed.label} is ready.</p>
              <Button
                nativeButton={false}
                render={<a href={printed.href} target="_blank" rel="noreferrer" />}
              >
                {printed.action}
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form
                className="flex flex-col gap-3"
                onSubmit={form.handleSubmit((value) => submit.mutate(value))}
              >
                <fieldset disabled={submit.isPending} className="contents">
                  {children}
                </fieldset>
                <DialogFooter>
                  <SubmitButton isSubmitting={submit.isPending}>{submitLabel}</SubmitButton>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
