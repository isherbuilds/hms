import { useState } from "react";

import { ErrorNote } from "@/components/page";
import { errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

/** Capacity refusals (a clash, a block, a past time) stay in the dialog, which keeps its
 * inputs, to be fixed there. A record changed on another screen closes it, since its
 * revision is stale; the server's message reaches the desk as a toast. A resubmission
 * clears the refusal shown. */
export function useRefusal(onClose: () => void) {
  const [refused, setRefused] = useState<{ message: string; reason?: string } | null>(null);

  const showsInline = (error: Error) =>
    hasErrorCode(error, "BAD_REQUEST") ||
    (hasErrorCode(error, "CONFLICT") && errorReason(error) !== "stale_record");

  // An error raised as a toast clears the refusal, so the dialog never shows a stale reason.
  const onError = (error: Error) => {
    const inline = showsInline(error);

    setRefused(inline ? { message: errorMessage(error), reason: errorReason(error) } : null);

    if (!inline && hasErrorCode(error, "CONFLICT")) onClose();
  };

  return {
    refusal: refused?.message ?? null,
    reason: refused?.reason,
    onError,
    showsInline,
    clear: () => setRefused(null),
  };
}

export function Refusal({ title, refusal }: { title: string; refusal: string | null }) {
  return refusal === null ? null : <ErrorNote title={title} detail={refusal} />;
}
