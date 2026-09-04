import { payerType, type PayerType } from "@hms/api/lib/schemas";

export type { PayerType };

export const PAYER_TYPES = payerType.options;

export const PAYER_TYPE_LABELS = {
  insurer: "Insurer",
  tpa: "TPA",
  corporate: "Corporate",
  scheme: "Scheme",
} satisfies Record<PayerType, string>;
