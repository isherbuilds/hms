import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderBillingPdf } from "../../apps/web/src/lib/billing-pdf";
import { billingPdfFixture } from "./billing-pdf-fixture";

const outputDirectory = resolve(process.argv[2] ?? "output/pdf");
await mkdir(outputDirectory, { recursive: true });

const data = billingPdfFixture({ lineCount: 72 });
const a4 = await renderBillingPdf({
  kind: "invoice",
  data,
  documentId: null,
  layout: "a4",
});
const thermal = await renderBillingPdf({
  kind: "invoice",
  data: billingPdfFixture({ lineCount: 8 }),
  documentId: null,
  layout: "thermal",
});

await Promise.all([
  writeFile(resolve(outputDirectory, "billing-invoice-a4-verification.pdf"), a4.bytes),
  writeFile(resolve(outputDirectory, "billing-invoice-thermal-verification.pdf"), thermal.bytes),
]);
