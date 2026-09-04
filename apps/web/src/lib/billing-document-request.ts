import { z } from "zod";

import { BILLING_DOCUMENT_LAYOUTS } from "@/lib/billing-document";
import type { BillingDocumentRequest } from "@/lib/billing-document";

const download = z.literal("1").optional();
const invoiceSearch = z
  .object({
    kind: z.literal("invoice"),
    layout: z.enum(BILLING_DOCUMENT_LAYOUTS).optional(),
    download,
  })
  .strict();
const childSearch = z
  .object({
    kind: z.enum(["receipt", "credit-note", "refund"]),
    id: z.string().min(1),
    layout: z.literal("a4").optional(),
    download,
  })
  .strict();

export function parseBillingDocumentRequest(
  searchParams: URLSearchParams,
): { document: BillingDocumentRequest; download: boolean } | null {
  const raw = Object.fromEntries(searchParams);
  const parsed = z.union([invoiceSearch, childSearch]).safeParse(raw);
  if (!parsed.success) return null;

  if (parsed.data.kind === "invoice") {
    return {
      document: {
        kind: "invoice",
        documentId: null,
        layout: parsed.data.layout ?? "a4",
      },
      download: parsed.data.download === "1",
    };
  }

  return {
    document: {
      kind: parsed.data.kind,
      documentId: parsed.data.id,
      layout: "a4",
    },
    download: parsed.data.download === "1",
  };
}
