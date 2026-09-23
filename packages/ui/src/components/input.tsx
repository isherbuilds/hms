import type * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { controlBase } from "@hms/ui/lib/control";
import { cn } from "@hms/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        controlBase,
        "h-8 w-full min-w-0 px-2.5 py-1 file:mr-2 file:inline-flex file:h-6 file:cursor-pointer file:rounded-sm file:border-0 file:bg-muted file:px-2 file:text-xs file:font-medium file:text-foreground disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
