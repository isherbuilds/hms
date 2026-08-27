import * as React from "react";

import { cn } from "@hms/ui/lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground transition-colors outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
