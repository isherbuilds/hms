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

import { ErrorNote } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { closeOnConflict, errorMessage } from "@/lib/orpc-error";

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
  onError,
  showsInline,
  refusalTitle,
  onSubmit,
  contentClassName,
  children,
}: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  schema: T;
  defaultValues: DefaultValues<z.input<T>>;
  success: string;
  run: (value: z.output<T>) => Promise<R>;
  /** Keeps the dialog open on success, showing the document the call produced, if any. */
  done?: (result: R) => Printed | null;
  onClose: () => void;
  /** Replaces closing on a CONFLICT not shown inline, for a dialog that offers a way on. */
  onError?: (error: Error, value: z.output<T>) => void;
  /** True for an error the dialog shows; it then raises no toast. */
  showsInline?: (error: Error, value: z.output<T>) => boolean;
  /** Titles the note showing an inline error; without it the children show the refusal. */
  refusalTitle?: string;
  /** Runs as the form is submitted, before the call: a dialog clears its last refusal. */
  onSubmit?: () => void;
  contentClassName?: string;
  children: ReactNode;
}) {
  const form = useZodForm(schema, { defaultValues });

  const [printed, setPrinted] = useState<Printed | null>(null);

  const submit = useMutation({
    mutationFn: (value: z.output<T>) => run(value),
    // SAFETY: the variables TanStack hands back are the value this mutation was called with.
    meta: showsInline
      ? { showsInline: (error, value) => showsInline(error, value as z.output<T>) }
      : undefined,
    onSuccess: (result) => {
      const printable = done?.(result) ?? null;

      if (printable) setPrinted(printable);
      else onClose();
      toast.success(success);
    },
    onError:
      onError ??
      ((error, value) => {
        if (!showsInline?.(error, value)) closeOnConflict(onClose)(error);
      }),
  });

  const refusal =
    submit.isError && showsInline?.(submit.error, submit.variables)
      ? errorMessage(submit.error)
      : null;

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(open) => (open || submit.isPending ? undefined : onClose())}>
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
                onSubmit={form.handleSubmit((value) => {
                  onSubmit?.();
                  submit.mutate(value);
                })}
              >
                <fieldset disabled={submit.isPending} className="contents">
                  {children}
                </fieldset>
                {refusalTitle === undefined || refusal === null ? null : (
                  <ErrorNote title={refusalTitle} detail={refusal} />
                )}
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
