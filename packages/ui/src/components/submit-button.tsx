import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { LoaderCircleIcon } from "lucide-react";
import type * as React from "react";

/**
 * Submit affordance in the midday-ai shape: the label goes invisible (not
 * removed, so the button keeps its width) and a spinner overlays it while the
 * mutation is in flight. Callers additionally pass `disabled` for their own
 * gates, e.g. a pristine form.
 */
export function SubmitButton({
  children,
  isSubmitting,
  disabled,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { isSubmitting: boolean }) {
  return (
    <Button
      type="submit"
      disabled={isSubmitting || disabled}
      className={cn("relative", className)}
      {...props}
    >
      <span className={cn(isSubmitting && "invisible")}>{children}</span>
      {isSubmitting && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
        </span>
      )}
    </Button>
  );
}
