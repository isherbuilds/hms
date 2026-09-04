"use client";

import { Label } from "@hms/ui/components/label";
import { cn } from "@hms/ui/lib/utils";
import * as React from "react";
import {
  Controller,
  FormProvider,
  get,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldError,
  type FieldPath,
  type FieldValues,
  type RegisterOptions,
  type UseFormRegisterReturn,
} from "react-hook-form";

const Form = FormProvider;

// The error alone: carrying the whole `fieldState` also subscribed every field to
// `dirtyFields`, `touchedFields` and `validatingFields`, which nothing renders.
type FormFieldContextValue = { error?: FieldError };

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  // Carried through so a schema whose output differs from its input still type-checks.
  TTransformedValues = TFieldValues,
>({ render, ...props }: ControllerProps<TFieldValues, TName, TTransformedValues>) {
  return (
    <Controller
      {...props}
      render={(state) => (
        // `fieldState` is lazy getters, so naming `error` subscribes to that slice alone.
        <FormFieldContext.Provider value={{ error: state.fieldState.error }}>
          {render(state)}
        </FormFieldContext.Provider>
      )}
    />
  );
}

type RegisteredFormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  name: TName;
  rules?: RegisterOptions<TFieldValues, TName>;
  render: (props: { field: UseFormRegisterReturn<TName> }) => React.ReactElement;
};

/**
 * The DOM holds the value, so the form re-renders only where it must.
 * Use `FormField` instead for anything whose displayed value can change after
 * mount — an external widget needing value/onChange, or a `<select>` whose options
 * arrive from a query. `register` writes the DOM value once, when the ref attaches.
 */
function RegisteredFormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ name, rules, render }: RegisteredFormFieldProps<TFieldValues, TName>) {
  const { control, register } = useFormContext<TFieldValues>();
  // Not `getFieldState`: it reads four slices of `formState` eagerly.
  const { errors } = useFormState({ control, name, exact: true });

  return (
    <FormFieldContext.Provider value={{ error: get(errors, name) }}>
      {render({ field: register(name, rules) })}
    </FormFieldContext.Provider>
  );
}

/** Disables its fields while the form submits, without waking the form around it. */
function FormFieldset(props: React.ComponentProps<"fieldset">) {
  const { control } = useFormContext();
  const { isSubmitting } = useFormState({ control });

  return <fieldset disabled={isSubmitting} {...props} />;
}

const FormItemContext = React.createContext<string | null>(null);

function useFormField() {
  const field = React.useContext(FormFieldContext);
  const id = React.useContext(FormItemContext);
  if (!field) {
    throw new Error("useFormField must be used within <FormField> or <RegisteredFormField>");
  }
  if (!id) {
    throw new Error("useFormField must be used within <FormItem>");
  }

  return {
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    error: field.error,
  };
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={id}>
      <div
        data-slot="form-item"
        // content-start: without it a taller sibling (one showing an error) stretches
        // this item's auto rows, and the label/control drift out of line across the row.
        className={cn("grid content-start gap-1.5", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      htmlFor={formItemId}
      className={cn("data-[error=true]:text-destructive", className)}
      {...props}
    />
  );
}

// Attaches the field's id and aria state to its single child control.
function FormControl({ children }: { children: React.ReactElement }) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id: formItemId,
    "aria-describedby": error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId,
    "aria-invalid": !!error,
  });
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;

  if (!body) {
    return null;
  }
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn(
        "animate-in text-xs text-destructive duration-150 fade-in-0 ease-out",
        className,
      )}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormFieldset,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
};
