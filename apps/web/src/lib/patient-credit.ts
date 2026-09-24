import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { formatMoney } from "@/lib/money";
import { errorMessage } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";

/**
 * Credit read when a settlement opens. `usable` is offered by default; `total` is
 * the amount the cashier may choose. `null` means the read failed.
 */
export type PatientCredit = { usable: bigint; total: bigint };

export async function openingCredit(
  queryClient: QueryClient,
  orgSlug: string,
  patientId: string,
  treatmentPlanId: string | null,
): Promise<PatientCredit | null> {
  try {
    return await queryClient.query({
      ...orpc.billing.patientCredit.queryOptions({
        input: { orgSlug, patientId, treatmentPlanId },
      }),
      staleTime: 0,
    });
  } catch (error) {
    toast.error(errorMessage(error, "Could not load patient credit"));

    return null;
  }
}

/** "₹300.00 available", or "₹100.00 for this bill · ₹300.00 in all" when another plan holds the rest. */
export function creditAvailableLabel(credit: PatientCredit, currency: string) {
  const total = formatMoney(credit.total, currency);

  return credit.usable < credit.total
    ? `${formatMoney(credit.usable, currency)} for this bill · ${total} in all`
    : `${total} available`;
}
