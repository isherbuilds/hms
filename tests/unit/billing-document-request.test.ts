import { expect, test } from "bun:test";

import { parseBillingDocumentRequest } from "../../apps/web/src/lib/billing-document-request";
import { pdfContentDisposition } from "../../apps/web/src/lib/content-disposition";

test("accepts only the explicit download marker", () => {
  expect(parseBillingDocumentRequest(new URLSearchParams("kind=invoice&download=1"))).toEqual({
    document: { kind: "invoice", documentId: null, layout: "a4" },
    download: true,
  });
  expect(
    parseBillingDocumentRequest(new URLSearchParams("kind=invoice&download=false")),
  ).toBeNull();
});

test("requires a child id and rejects document fields on an invoice", () => {
  expect(parseBillingDocumentRequest(new URLSearchParams("kind=receipt"))).toBeNull();
  expect(parseBillingDocumentRequest(new URLSearchParams("kind=invoice&id=payment-1"))).toBeNull();
  expect(
    parseBillingDocumentRequest(new URLSearchParams("kind=receipt&id=payment-1&layout=thermal")),
  ).toBeNull();
});

test("builds a valid content disposition for hostile and Unicode file names", () => {
  const header = pdfContentDisposition('INV-\r\n"कविता.pdf', true);

  expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  expect(header).toBe(
    "attachment; filename=\"billing-document.pdf\"; filename*=UTF-8''INV-__%22%E0%A4%95%E0%A4%B5%E0%A4%BF%E0%A4%A4%E0%A4%BE.pdf",
  );
});
