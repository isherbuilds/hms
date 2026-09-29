"use client";

import { Combobox as Primitive } from "@base-ui/react/combobox";
import type * as React from "react";

import { Input } from "@hms/ui/components/input";
import { cn } from "@hms/ui/lib/utils";

const Combobox = Primitive.Root;

function ComboboxInput(props: Primitive.Input.Props) {
  return <Primitive.Input render={<Input data-slot="combobox-input" />} {...props} />;
}

function ComboboxContent({ className, ...props }: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="isolate z-50 outline-none" sideOffset={4} align="start">
        <Primitive.Popup
          data-slot="combobox-content"
          className={cn(
            "z-50 w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md bg-popover text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

const ITEM_CLASS =
  "relative flex min-h-8 cursor-default items-center rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

function ComboboxItem({ className, ...props }: Primitive.Item.Props) {
  return (
    <Primitive.Item data-slot="combobox-item" className={cn(ITEM_CLASS, className)} {...props} />
  );
}

function ComboboxEmpty(props: Primitive.Empty.Props) {
  return <Primitive.Empty data-slot="combobox-empty" {...props} />;
}

type PopupProps<T> = {
  getItemKey: (item: T) => React.Key;
  renderItem: (item: T) => React.ReactNode;
  isItemDisabled?: (item: T) => boolean;
  emptyContent?: React.ReactNode;
  popupClassName?: string;
  itemClassName?: string;
};

/** Shared results layout for server-searched records. */
function ComboboxPopup<T>({
  getItemKey,
  renderItem,
  isItemDisabled,
  emptyContent,
  popupClassName,
  itemClassName,
}: PopupProps<T>) {
  return (
    <ComboboxContent className={cn(emptyContent == null && "data-empty:hidden", popupClassName)}>
      <ComboboxEmpty className="text-muted-foreground">{emptyContent}</ComboboxEmpty>
      <ComboboxList>
        {(item: T) => (
          <ComboboxItem
            key={getItemKey(item)}
            value={item}
            disabled={isItemDisabled?.(item)}
            className={itemClassName}
          >
            {renderItem(item)}
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  );
}

export { Combobox, ComboboxInput, ComboboxPopup, ITEM_CLASS };
