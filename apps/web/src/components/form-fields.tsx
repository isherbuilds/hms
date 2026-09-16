import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { Textarea } from "@hms/ui/components/textarea";
import type { ComponentProps, ReactNode } from "react";
import { useFormContext, type ControllerRenderProps, type FieldValues } from "react-hook-form";

type FieldRow = {
  name: string;
  label: ReactNode;
  description?: ReactNode;
  /** Places the row; every other prop reaches the control. */
  className?: string;
};

// Both controls' attributes, so one props object spreads into either without a cast.
type ControlProps = Omit<
  ComponentProps<"input"> & ComponentProps<"textarea">,
  "onChange" | "onBlur" | "ref"
>;

/** A native control registered by name; use `ControlledField` for a controlled widget. */
export function TextField({
  name,
  label,
  description,
  multiline,
  className,
  ...control
}: FieldRow & ControlProps & { multiline?: boolean }) {
  return (
    <RegisteredFormField
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? <Textarea {...control} {...field} /> : <Input {...control} {...field} />}
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** `render` draws the control, so it keeps the `FormControl` carrying the field id and aria state. */
export function ControlledField({
  name,
  label,
  description,
  className,
  render,
}: FieldRow & { render: (field: ControllerRenderProps<FieldValues, string>) => ReactNode }) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          {render(field)}
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
