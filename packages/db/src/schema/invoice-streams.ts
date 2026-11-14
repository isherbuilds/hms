// Dependency-free on purpose: zod, the server and the client all read one list.
export const INVOICE_STREAMS = ["opd", "pharmacy", "ipd"] as const;

export type InvoiceStream = (typeof INVOICE_STREAMS)[number];

export const INVOICE_STREAM_LABELS = {
  opd: "OPD",
  pharmacy: "Pharmacy",
  ipd: "IPD",
} as const satisfies Record<InvoiceStream, string>;
