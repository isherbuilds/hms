"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import * as React from "react";

import { Input } from "@hms/ui/components/input";
import { cn } from "@hms/ui/lib/utils";

type ComboboxEntry<T> =
  | { kind: "item"; item: T; key: React.Key }
  | { kind: "create"; key: "__create__" };

type ComboboxProps<T> = {
  items: T[];
  getItemKey: (item: T) => React.Key;
  getItemLabel?: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onSelect: (item: T) => void;
  isItemDisabled?: (item: T) => boolean;
  emptyContent?: React.ReactNode;
  onCreate?: (inputValue: string) => void;
  renderCreate?: (inputValue: string) => React.ReactNode;
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
  onCreate,
  renderCreate,
  open,
  onOpenChange,
  disabled,
  inputRef,
  inputProps,
  inputClassName,
  popupClassName,
  itemClassName,
}: ComboboxProps<T>) {
  const canCreate = Boolean(onCreate && renderCreate && inputValue.trim());
  const entries: ComboboxEntry<T>[] = [
    ...items.map((item) => ({ kind: "item" as const, item, key: getItemKey(item) })),
    ...(canCreate ? [{ kind: "create" as const, key: "__create__" as const }] : []),
  ];

  return (
    <ComboboxPrimitive.Root<ComboboxEntry<T>>
      items={entries}
      value={null}
      inputValue={inputValue}
      onInputValueChange={(value, { reason }) => {
        if (reason !== "item-press") onInputValueChange(value);
      }}
      onValueChange={(entry) => {
        if (!entry) return;
        if (entry.kind === "create") onCreate?.(inputValue);
        else onSelect(entry.item);
      }}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
      itemToStringLabel={(entry) =>
        entry.kind === "create" ? inputValue : (getItemLabel?.(entry.item) ?? String(entry.key))
      }
      itemToStringValue={(entry) => (entry == null ? "" : String(entry.key))}
      isItemEqualToValue={(entry, value) =>
        entry != null && value != null && entry.kind === value.kind && entry.key === value.key
      }
      // `filter={null}` still applies the default starts-with filter in
      // @base-ui/react 1.6; an explicit pass-all keeps consumers in charge.
      filter={() => true}
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
              emptyContent == null && !canCreate && "data-empty:hidden",
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
              {(entry: ComboboxEntry<T>) => (
                <ComboboxPrimitive.Item
                  key={entry.kind === "create" ? "__combobox-create__" : `item-${entry.key}`}
                  value={entry}
                  disabled={entry.kind === "item" ? isItemDisabled?.(entry.item) : false}
                  data-slot="combobox-item"
                  className={cn(
                    "relative flex cursor-default items-center rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
                    itemClassName,
                  )}
                >
                  {entry.kind === "create" ? renderCreate?.(inputValue) : renderItem(entry.item)}
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
