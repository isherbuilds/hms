"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import * as React from "react";

import { Input } from "@hms/ui/components/input";
import { cn } from "@hms/ui/lib/utils";

type AutocompleteProps<T> = {
  items: readonly T[];
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: T) => void;
  getItemKey: (item: T) => React.Key;
  getItemLabel: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyContent?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: Omit<
    React.ComponentPropsWithoutRef<"input">,
    "className" | "disabled" | "onChange" | "value"
  >;
  inputClassName?: string;
};

function Autocomplete<T>({
  items,
  value,
  onValueChange,
  onSelect,
  getItemKey,
  getItemLabel,
  renderItem,
  emptyContent,
  open,
  onOpenChange,
  inputRef,
  inputProps,
  inputClassName,
}: AutocompleteProps<T>) {
  return (
    <AutocompletePrimitive.Root<T>
      items={items}
      mode="none"
      value={value}
      onValueChange={(nextValue, details) => {
        if (details.reason !== "item-press") onValueChange(nextValue);
      }}
      onOpenChange={onOpenChange}
      open={open}
      itemToStringValue={getItemLabel}
      loopFocus
    >
      <AutocompletePrimitive.Input
        ref={inputRef}
        render={<Input data-slot="autocomplete-input" />}
        className={inputClassName}
        {...inputProps}
      />
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
          align="start"
        >
          <AutocompletePrimitive.Popup
            data-slot="autocomplete-content"
            className={cn(
              "z-50 w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md bg-popover text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
              emptyContent == null && "data-empty:hidden",
            )}
          >
            <AutocompletePrimitive.Empty
              data-slot="autocomplete-empty"
              className="text-muted-foreground"
            >
              {emptyContent}
            </AutocompletePrimitive.Empty>
            <AutocompletePrimitive.List
              data-slot="autocomplete-list"
              className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0"
            >
              {(item: T) => (
                <AutocompletePrimitive.Item
                  key={getItemKey(item)}
                  value={item}
                  onClick={() => onSelect(item)}
                  data-slot="autocomplete-item"
                  className="relative flex min-h-8 cursor-default items-center rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                >
                  {renderItem(item)}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
}

export { Autocomplete, type AutocompleteProps };
