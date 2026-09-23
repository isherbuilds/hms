import { cn } from "@hms/ui/lib/utils";
import { Label } from "@hms/ui/components/label";

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset data-slot="field-set" className={cn("flex flex-col gap-4", className)} {...props} />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn("mb-2.5 text-xs font-medium", className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex w-full flex-col gap-4", className)}
      {...props}
    />
  );
}

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn(
        "group/field flex w-full flex-col gap-2 *:w-full data-[invalid=true]:text-destructive [&>.sr-only]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn("flex w-fit gap-2 leading-snug", className)}
      {...props}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<"div">) {
  if (!children) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-xs font-normal text-destructive", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Field, FieldLabel, FieldError, FieldGroup, FieldLegend, FieldSet };
