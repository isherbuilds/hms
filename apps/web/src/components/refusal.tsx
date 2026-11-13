import { useState } from "react";

import { ErrorNote } from "@/components/page";
import { errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

/** Capacity refusals (a clash, a block, a past time) stay in the dialog, which keeps its
 * inputs, to be fixed there. A record changed on another screen closes it, since its
 * revision is stale; the server's message reaches the desk as a toast. */
export function useRefusal(onClose: () => void) {
  const [refused, setRefused] = useState<{ message: string; reason?: string } | null>(null);

  const showsInline = (error: Error) =>
    hasErrorCode(error, "BAD_REQUEST") ||
    (hasErrorCode(error, "CONFLICT") && errorReason(error) !== "stale_record");

  const onError = (error: Error) => {
    if (showsInline(error)) {
      setRefused({ message: errorMessage(error), reason: errorReason(error) });
    } else if (hasErrorCode(error, "CONFLICT")) onClose();
  };

  return { refusal: refused?.message ?? null, reason: refused?.reason, onError, showsInline };
}

export function Refusal({ title, refusal }: { title: string; refusal: string | null }) {
  return refusal === null ? null : <ErrorNote title={title} detail={refusal} />;
}
