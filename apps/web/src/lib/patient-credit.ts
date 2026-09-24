import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

/**
 * The credit a settlement overlay opens with, read on the click so no round trip is spent
 * on patients nobody settles: untagged credit plus the advance for `treatmentPlanId`, the
 * bill's plan (null outside one). `null` means the read failed and the overlay must not open.
 */
export async function openingCredit(
  queryClient: QueryClient,
  orgSlug: string,
  patientId: string,
  treatmentPlanId: string | null,
): Promise<bigint | null> {
  try {
    const { usable } = await queryClient.query({
      ...orpc.billing.patientCredit.queryOptions({
        input: { orgSlug, patientId, treatmentPlanId },
      }),
      staleTime: 0,
    });

    return usable;
  } catch (error) {
    toast.error(errorMessage(error, "Could not load patient credit"));

    return null;
  }
}
