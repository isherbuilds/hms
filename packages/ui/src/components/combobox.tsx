"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import * as React from "react";

import { Input } from "@hms/ui/components/input";
import { cn } from "@hms/ui/lib/utils";

type ComboboxProps<T> = {
  items: T[];
  getItemKey: (item: T) => React.Key;
  getItemLabel: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onSelect: (item: T) => void;
  isItemDisabled?: (item: T) => boolean;
  emptyContent?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: Omit<
    React.ComponentPropsWithoutRef<"input">,
    "className" | "disabled" | "onChange" | "value"
  >;
  inputClassName?: string;
  popupClassName?: string;
  itemClassName?: string;
};

/**
 * A compact action combobox. Consumers own filtering and selection state; this
 * component only supplies the accessible input, popup, and keyboard behavior.
 */
function Combobox<T>({
  items,
  getItemKey,
  getItemLabel,
  renderItem,
  inputValue,
  onInputValueChange,
  onSelect,
  isItemDisabled,
  emptyContent,
  open,
  onOpenChange,
  disabled,
  inputRef,
  inputProps,
  inputClassName,
  popupClassName,
  itemClassName,
}: ComboboxProps<T>) {
  return (
    <ComboboxPrimitive.Root<T>
      items={items}
      value={null}
      inputValue={inputValue}
      onInputValueChange={(value, { reason }) => {
        if (reason !== "item-press") onInputValueChange(value);
      }}
      onValueChange={(item) => {
        if (item != null) onSelect(item);
      }}
      open={open}
      onOpenChange={onOpenChange}
      itemToStringLabel={getItemLabel}
      itemToStringValue={(item) => (item == null ? "" : String(getItemKey(item)))}
      isItemEqualToValue={(item, value) =>
        item != null && value != null && getItemKey(item) === getItemKey(value)
      }
      // Consumers own filtering; `filter={null}` is the documented pass-all
      // for externally filtered lists in @base-ui/react 1.7.
      filter={null}
      loopFocus
      disabled={disabled}
    >
      <ComboboxPrimitive.Input
        ref={inputRef}
        render={<Input data-slot="combobox-input" />}
        className={inputClassName}
        {...inputProps}
      />
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
          align="start"
        >
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            className={cn(
              "z-50 w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md bg-popover text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
              emptyContent == null && "data-empty:hidden",
              popupClassName,
            )}
          >
            <ComboboxPrimitive.Empty data-slot="combobox-empty" className="text-muted-foreground">
              {emptyContent}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List
              data-slot="combobox-list"
              className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0"
            >
              {(item: T) => (
                <ComboboxPrimitive.Item
                  key={getItemKey(item)}
                  value={item}
                  disabled={isItemDisabled?.(item)}
                  data-slot="combobox-item"
                  className={cn(
                    // The inset bar keeps keyboard highlighting distinguishable from the popover.
                    "relative flex cursor-default items-center rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:shadow-[inset_2px_0_0_var(--foreground)] data-disabled:pointer-events-none data-disabled:opacity-50",
                    itemClassName,
                  )}
                >
                  {renderItem(item)}
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

export { Combobox, type ComboboxProps };
