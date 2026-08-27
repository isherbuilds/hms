import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "@hms/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { Button } from "@hms/ui/components/button";
import * as React from "react";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

const sheetVariants = cva(
  "fixed z-50 flex flex-col overflow-hidden overscroll-contain rounded-xl border-8 border-muted bg-popover text-xs/relaxed text-popover-foreground shadow-lg transition duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
  {
    variants: {
      side: {
        top: "inset-x-2 top-2 data-ending-style:-translate-y-10 data-starting-style:-translate-y-10 md:inset-x-4 md:top-4",
        bottom:
          "inset-x-2 bottom-2 data-ending-style:translate-y-10 data-starting-style:translate-y-10 md:inset-x-4 md:bottom-4",
        right:
          "inset-y-2 right-2 left-2 data-ending-style:translate-x-10 data-starting-style:translate-x-10 md:inset-y-4 md:right-4 md:left-auto md:w-lg",
        left: "inset-y-2 right-2 left-2 data-ending-style:-translate-x-10 data-starting-style:-translate-x-10 md:inset-y-4 md:right-auto md:left-4 md:w-lg",
      },
    },
    defaultVariants: { side: "right" },
  },
);

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props &
  VariantProps<typeof sheetVariants> & { showCloseButton?: boolean }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          sheetVariants({ side }),
          showCloseButton && "[&>[data-slot=sheet-header]]:pr-12",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 text-muted-foreground"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-2 border-b border-border p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border p-4",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-medium text-balance", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle };
