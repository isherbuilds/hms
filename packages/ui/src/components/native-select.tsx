import type * as React from "react";

import { controlBase } from "@hms/ui/lib/control";
import { cn } from "@hms/ui/lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        controlBase,
        "h-8 w-full px-2 text-foreground [color-scheme:light] disabled:pointer-events-none dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
