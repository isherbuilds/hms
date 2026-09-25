import { Input } from "@hms/ui/components/input";
import {
  OptionCombobox as BaseOptionCombobox,
  type OptionComboboxProps,
} from "@hms/ui/components/option-combobox";
import { ClientOnly } from "@tanstack/react-router";

/** Base UI popups render client-only; the server paints the chosen label in a disabled input. */
export function OptionCombobox(props: OptionComboboxProps) {
  const { options, value, id, name, placeholder, className } = props;
  const label = options.find((option) => option.value === value)?.label ?? "";

  return (
    <ClientOnly
      fallback={
        <Input
          id={id}
          name={name}
          placeholder={placeholder}
          className={className}
          aria-label={props["aria-label"]}
          value={label}
          readOnly
          disabled
        />
      }
    >
      <BaseOptionCombobox {...props} />
    </ClientOnly>
  );
}
