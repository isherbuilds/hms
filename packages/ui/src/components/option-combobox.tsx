"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ComboboxPopup } from "@hms/ui/components/combobox";
import { Input } from "@hms/ui/components/input";
import type * as React from "react";
import { useState, type ComponentPropsWithoutRef, type Ref } from "react";

type Option = { value: string; label: string };

const sameOption = (a: Option, b: Option) => a.value === b.value;

const optionValue = (option: Option) => option.value;

const optionLabel = (option: Option) => option.label;

/**
 * Search a loaded record list while the form stores the selected record's id.
 * Fixed choices use NativeSelect; server-searched records use Combobox.
 */
function OptionCombobox({
  options,
  value,
  onChange,
  onBlur,
  ref,
  name,
  disabled,
  placeholder,
  className,
  itemClassName,
  onEnter,
  ...inputProps
}: {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ref?: Ref<HTMLInputElement>;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  itemClassName?: string;
  /** Enter on a settled choice (popup closed), e.g. to move to the next field. */
  onEnter?: () => void;
} & Pick<
  ComponentPropsWithoutRef<"input">,
  "id" | "aria-label" | "aria-describedby" | "aria-invalid"
>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const fieldProps = { ...inputProps, name, placeholder, autoComplete: "off", className };

  return (
    <ComboboxPrimitive.Root<Option>
      items={options}
      value={selected}
      onValueChange={(option) => {
        // Clearing the text clears the choice, so the field never keeps a hidden id.
        onChange(option?.value ?? "");
        setQuery("");
      }}
      onInputValueChange={(input, details) => {
        setQuery(details.reason === "input-change" ? input.trim() : "");
      }}
      open={open && query.length >= 2}
      onOpenChange={setOpen}
      limit={6}
      isItemEqualToValue={sameOption}
      autoHighlight
      loopFocus
      disabled={disabled}
    >
      <ComboboxPrimitive.Input
        ref={ref}
        render={<Input data-slot="combobox-input" />}
        {...fieldProps}
        onBlur={onBlur}
        // Like a native select, Enter never submits the form behind it.
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

          event.preventDefault();

          if (selected && !query && event.currentTarget.getAttribute("aria-expanded") !== "true") {
            onEnter?.();
          }
        }}
      />
      <ComboboxPopup
        getItemKey={optionValue}
        renderItem={optionLabel}
        emptyContent={<p className="px-3 py-2">No match</p>}
        itemClassName={itemClassName}
      />
    </ComboboxPrimitive.Root>
  );
}

type OptionComboboxProps = React.ComponentProps<typeof OptionCombobox>;

export { OptionCombobox, type OptionComboboxProps };
