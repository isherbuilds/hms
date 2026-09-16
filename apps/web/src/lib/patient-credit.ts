import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

/**
 * The credit a settlement overlay opens with, read on the click so no round trip is spent
 * on patients nobody settles. `null` means the read failed and the overlay must not open.
 */
export async function openingCredit(
  queryClient: QueryClient,
  orgSlug: string,
  patientId: string,
): Promise<bigint | null> {
  try {
    const { total } = await queryClient.query(
      orpc.billing.patientCredit.queryOptions({ input: { orgSlug, patientId } }),
    );

    return total;
  } catch (error) {
    toast.error(errorMessage(error, "Could not load patient credit"));

    return null;
  }
}
