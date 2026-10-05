import { splitGst } from "@hms/api/lib/invoice-math";
import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";
import type { CSSProperties, ReactNode } from "react";
import { formatBusinessDate } from "@/lib/business-date";
import { formatDecimal } from "@hms/api/core/money";
import { formatMoney, ZERO } from "@/lib/money";
import { methodLabel } from "@/lib/settlement";
import { gstStateLabel } from "@hms/api/lib/gst-state";

export type InvoiceBundle = Awaited<ReturnType<RouterClient<AppRouter>["billing"]["getInvoice"]>>;

export type AdvanceBundle = Awaited<
  ReturnType<RouterClient<AppRouter>["billing"]["getAdvanceReceipt"]>
>;

type Invoice = InvoiceBundle["invoice"];

type Payment = InvoiceBundle["payments"][number];

type CreditNote = InvoiceBundle["creditNotes"][number];

type Refund = InvoiceBundle["refunds"][number];

type DocumentHeader = Pick<
  Invoice,
  | "orgAddress"
  | "orgLegalName"
  | "orgTaxId"
  | "orgGstin"
  | "currency"
  | "patientName"
  | "patientMrn"
> &
  Partial<Pick<Invoice, "orgDrugLicence20" | "orgDrugLicence21" | "stream">>;

export function invoiceDocumentTitle(invoice: Pick<Invoice, "orgGstin" | "stream">): string {
  if (!invoice.orgGstin) return "Invoice";

  return invoice.stream === "opd" ? "Bill of Supply" : "Tax Invoice";
}

export function advanceReceiptTitle(receipt: Pick<AdvanceBundle["receipt"], "orgGstin">): string {
  return receipt.orgGstin ? "Receipt Voucher" : "Advance Receipt";
}

function registrationRows(gstin: string) {
  return gstin
    ? [
        { label: "Place of supply", value: gstStateLabel(gstin) },
        { label: "Reverse charge", value: "No" },
      ]
    : [];
}

const personName = { textTransform: "capitalize" } as const;

const colors = {
  ink: "#18181b",
  muted: "#71717a",
  border: "#d4d4d8",
  panel: "#f4f4f5",
  accent: "#075985",
};

const documentStyle: CSSProperties = {
  color: colors.ink,
  fontSize: 10,
  lineHeight: 1.45,
};

const tableStyle: CSSProperties = {
  borderCollapse: "collapse",
  marginTop: 8,
  width: "100%",
};

const headingCellStyle: CSSProperties = {
  backgroundColor: colors.panel,
  borderBottom: `1px solid ${colors.border}`,
  color: colors.muted,
  fontSize: 8,
  fontWeight: 700,
  padding: "7px 6px",
  textAlign: "left",
  textTransform: "uppercase",
};

const cellStyle: CSSProperties = {
  borderBottom: `1px solid ${colors.border}`,
  padding: "7px 6px",
  verticalAlign: "top",
};

function DocumentShell({
  document,
  title,
  number,
  thermal = false,
  children,
}: {
  document: DocumentHeader;
  title: string;
  number: string;
  thermal?: boolean;
  children: ReactNode;
}) {
  const letterhead = [
    document.orgAddress.replace(/\n/g, ", ").trim(),
    document.orgTaxId && document.orgTaxId !== document.orgGstin
      ? `Tax ID ${document.orgTaxId}`
      : "",
    document.orgGstin ? `GSTIN ${document.orgGstin}` : "",
    document.stream === "pharmacy" && document.orgDrugLicence20
      ? `Drug licence (Form 20) ${document.orgDrugLicence20}`
      : "",
    document.stream === "pharmacy" && document.orgDrugLicence21
      ? `Drug licence (Form 21) ${document.orgDrugLicence21}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main style={{ ...documentStyle, padding: thermal ? 12 : 0 }}>
      <header
        style={{
          alignItems: thermal ? "center" : "flex-start",
          borderBottom: `2px solid ${colors.ink}`,
          display: "flex",
          flexDirection: thermal ? "column" : "row",
          justifyContent: "space-between",
          marginBottom: thermal ? 12 : 20,
          paddingBottom: 10,
          textAlign: thermal ? "center" : "left",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: thermal ? 15 : 18, lineHeight: 1.2, margin: 0 }}>
            {document.orgLegalName}
          </h1>
          {letterhead ? (
            <p style={{ color: colors.muted, fontSize: 8, margin: "4px 0 0" }}>{letterhead}</p>
          ) : null}
        </div>
        <div
          style={{
            flexShrink: 0,
            marginLeft: thermal ? 0 : 20,
            marginTop: thermal ? 10 : 0,
            textAlign: thermal ? "center" : "right",
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{title}</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{number}</div>
        </div>
      </header>
      {children}
      {document.orgGstin ? (
        <p style={{ marginTop: 24, textAlign: "right" }}>
          Authorised signatory: ____________________
        </p>
      ) : null}
    </main>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        color: colors.muted,
        fontSize: 8,
        letterSpacing: 0.4,
        margin: "0 0 6px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
  );
}

function Details({
  rows,
  roomy = false,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
  roomy?: boolean;
}) {
  return (
    <dl style={{ margin: 0 }}>
      {rows.map(({ label, value }) => (
        <div
          key={label}
          style={{
            borderBottom: roomy ? `1px solid ${colors.border}` : undefined,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            padding: roomy ? "8px 0" : "2px 0",
          }}
        >
          <dt style={{ color: colors.muted }}>{label}</dt>
          <dd style={{ fontWeight: 500, margin: 0, textAlign: "right" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryBox({ rows }: { rows: Array<{ label: string; value: string; total?: boolean }> }) {
  return (
    <div
      style={{
        backgroundColor: colors.panel,
        breakInside: "avoid",
        marginLeft: "auto",
        marginTop: 18,
        padding: 12,
        width: 240,
      }}
    >
      {rows.map(({ label, value, total }) => (
        <div
          key={label}
          style={{
            borderTop: total ? `1px solid ${colors.border}` : undefined,
            display: "flex",
            fontSize: total ? 11 : 9,
            fontWeight: total ? 700 : 500,
            justifyContent: "space-between",
            marginTop: total ? 6 : 0,
            paddingTop: total ? 7 : 2,
          }}
        >
          <span>{label}</span>
          <span style={{ color: total ? colors.accent : colors.ink }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function TaxSummary({
  lines,
  thermal = false,
}: {
  lines: InvoiceBundle["lines"];
  thermal?: boolean;
}) {
  const groups = new Map<string, { taxable: bigint; tax: bigint }>();

  for (const line of lines) {
    const amounts = groups.get(line.taxRatePercent) ?? { taxable: ZERO, tax: ZERO };
    amounts.taxable += line.taxableValue;
    amounts.tax += line.taxAmount;
    groups.set(line.taxRatePercent, amounts);
  }

  return (
    <section style={{ breakInside: "avoid", marginTop: 18 }}>
      <SectionTitle>GST summary</SectionTitle>
      <table style={{ ...tableStyle, width: thermal ? "100%" : 350 }}>
        <thead>
          <tr>
            <th style={headingCellStyle}>Rate</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>CGST</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>SGST</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(groups, ([rate, amounts]) => {
            const { cgst, sgst } = splitGst(amounts.tax);

            return (
              <tr key={rate}>
                <td style={cellStyle}>{rate}%</td>
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {formatDecimal(amounts.taxable)}
                </td>
                <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(cgst)}</td>
                <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(sgst)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function InvoiceDocument({
  invoice,
  lines,
  layout,
}: {
  invoice: Invoice;
  lines: InvoiceBundle["lines"];
  layout: "a4" | "thermal";
}) {
  const currency = invoice.currency;
  // Only a registered pharmacy bill carries GST; a registered OPD bill is exempt.
  const taxed = Boolean(invoice.orgGstin) && invoice.stream === "pharmacy";

  const unitLabel =
    invoice.stream === "pharmacy"
      ? invoice.orgGstin
        ? "MRP (incl. GST)"
        : "MRP (incl. all taxes)"
      : "Unit";

  const totals = [
    {
      label: taxed ? "Subtotal (incl. GST)" : "Subtotal",
      value: formatMoney(
        invoice.stream === "opd" ? invoice.subtotal + invoice.taxTotal : invoice.subtotal,
        currency,
      ),
    },
    { label: "Discount", value: formatMoney(invoice.discountAmount, currency) },
    ...(taxed ? [{ label: "GST included", value: formatMoney(invoice.taxTotal, currency) }] : []),
    ...(invoice.roundOff !== ZERO
      ? [{ label: "Round off", value: formatMoney(invoice.roundOff, currency) }]
      : []),
    { label: "Grand total", value: formatMoney(invoice.grandTotal, currency), total: true },
  ];

  const separator = (invoice.patientGuardian?.indexOf(" ") ?? -1) + 1;

  const guardian = invoice.patientGuardian ? (
    <>
      {invoice.patientGuardian.slice(0, separator)}
      <span style={personName}>{invoice.patientGuardian.slice(separator)}</span>
    </>
  ) : null;

  if (layout === "thermal") {
    return (
      <DocumentShell
        document={invoice}
        title={invoiceDocumentTitle(invoice)}
        number={invoice.invoiceNumber}
        thermal
      >
        <Details
          rows={[
            { label: "Issued", value: formatBusinessDate(invoice.businessDate) },
            {
              label: "Patient",
              value: (
                <span>
                  <span style={personName}>{invoice.patientName}</span>
                  {guardian ? <> {guardian}</> : null}
                </span>
              ),
            },
            ...(invoice.patientMrn ? [{ label: "MRN", value: invoice.patientMrn }] : []),
            { label: "Issued by", value: invoice.issuedByName },
            ...(invoice.patientAddress
              ? [{ label: "Address", value: invoice.patientAddress }]
              : []),
            ...registrationRows(invoice.orgGstin),
          ]}
        />
        <section style={{ marginTop: 10 }}>
          {lines.map((line) => (
            <div
              key={line.id}
              style={{
                borderBottom: `1px dashed ${colors.border}`,
                breakInside: "avoid",
                padding: "7px 0",
              }}
            >
              <div style={{ display: "flex", fontWeight: 700, justifyContent: "space-between" }}>
                <span>{`${line.description} × ${line.qty}`}</span>
                <span>{formatMoney(line.gross, currency)}</span>
              </div>
              <div style={{ color: colors.muted, fontSize: 8 }}>
                {`${unitLabel} ${formatDecimal(line.unitPrice)}${line.priceUnits > 1 ? ` / ${line.priceUnits}` : ""}${taxed ? ` · value ${formatDecimal(line.taxableValue)} · tax ${formatDecimal(line.taxAmount)} @ ${line.taxRatePercent}%` : ""}`}
              </div>
            </div>
          ))}
        </section>
        {taxed ? <TaxSummary lines={lines} thermal /> : null}
        <Details roomy rows={totals} />
      </DocumentShell>
    );
  }

  return (
    <DocumentShell
      document={invoice}
      title={invoiceDocumentTitle(invoice)}
      number={invoice.invoiceNumber}
    >
      <section style={{ display: "flex", gap: 28, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Invoice details</SectionTitle>
          <Details
            rows={[
              { label: "Issued", value: formatBusinessDate(invoice.businessDate) },
              { label: "Issued by", value: invoice.issuedByName },
              { label: "Currency", value: currency },
              ...registrationRows(invoice.orgGstin),
            ]}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SectionTitle>Billed to</SectionTitle>
          <div style={{ ...personName, fontWeight: 700 }}>{invoice.patientName}</div>
          {guardian ? <div style={{ color: colors.muted }}>{guardian}</div> : null}
          {invoice.patientMrn ? (
            <div style={{ color: colors.muted }}>MRN {invoice.patientMrn}</div>
          ) : null}
          {invoice.patientPhone ? (
            <div style={{ color: colors.muted }}>{invoice.patientPhone}</div>
          ) : null}
          {invoice.patientAddress ? (
            <div style={{ color: colors.muted }}>{invoice.patientAddress.replace(/\n/g, ", ")}</div>
          ) : null}
        </div>
      </section>

      <SectionTitle>Items</SectionTitle>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={headingCellStyle}>Description</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Qty</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>{unitLabel}</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Discount</th>
            {taxed ? (
              <>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Rate</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Tax</th>
              </>
            ) : null}
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Gross</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td style={cellStyle}>
                <strong>{line.description}</strong>
                {line.taxCode ? (
                  <div style={{ color: colors.muted, fontSize: 8 }}>Code {line.taxCode}</div>
                ) : null}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.qty}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                {formatDecimal(line.unitPrice)}
                {line.priceUnits > 1 ? ` / ${line.priceUnits}` : ""}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                {formatDecimal(line.allocatedDiscount)}
              </td>
              {taxed ? (
                <>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {formatDecimal(line.taxableValue)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>{`${line.taxRatePercent}%`}</td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {formatDecimal(line.taxAmount)}
                  </td>
                </>
              ) : null}
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {taxed ? <TaxSummary lines={lines} /> : null}

      <SummaryBox rows={totals} />
    </DocumentShell>
  );
}

export function ReceiptDocument({ invoice, payment }: { invoice: Invoice; payment: Payment }) {
  return (
    <DocumentShell document={invoice} title="Payment receipt" number={payment.receiptNumber}>
      <SectionTitle>Receipt details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(payment.businessDate) },
          {
            label: "Received from",
            value: (
              <>
                <span style={personName}>{invoice.patientName}</span>
                {invoice.patientMrn ? ` · MRN ${invoice.patientMrn}` : null}
              </>
            ),
          },
          { label: "Against invoice", value: invoice.invoiceNumber },
          { label: "Method", value: methodLabel(payment.method) },
          ...(payment.reference ? [{ label: "Reference", value: payment.reference }] : []),
          { label: "Amount received", value: formatMoney(payment.amount, invoice.currency) },
        ]}
      />
    </DocumentShell>
  );
}

export function CreditNoteDocument({
  invoice,
  invoiceLines,
  note,
}: {
  invoice: Invoice;
  invoiceLines: InvoiceBundle["lines"];
  note: CreditNote;
}) {
  const sourceLines = new Map(invoiceLines.map((line) => [line.id, line]));
  const taxed = Boolean(invoice.orgGstin) && invoice.stream === "pharmacy";

  const rows = note.lines.map((line) => {
    const source = sourceLines.get(line.invoiceLineId);

    if (!source) {
      throw new Error(
        `Invoice line ${line.invoiceLineId} is missing from ${invoice.invoiceNumber}`,
      );
    }

    return { line, source };
  });

  return (
    <DocumentShell document={invoice} title="Credit note" number={note.creditNoteNumber}>
      <section style={{ display: "flex", gap: 28, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Credit note details</SectionTitle>
          <Details
            rows={[
              { label: "Issued", value: formatBusinessDate(note.businessDate) },
              { label: "Against invoice", value: invoice.invoiceNumber },
              { label: "Invoice date", value: formatBusinessDate(invoice.businessDate) },
            ]}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SectionTitle>Issued to</SectionTitle>
          <strong style={personName}>{invoice.patientName}</strong>
          {invoice.patientMrn ? (
            <div style={{ color: colors.muted }}>MRN {invoice.patientMrn}</div>
          ) : null}
          {invoice.patientAddress ? (
            <div style={{ color: colors.muted }}>{invoice.patientAddress}</div>
          ) : null}
        </div>
      </section>
      <p style={{ margin: "0 0 12px" }}>
        <strong>Reason:</strong> {note.reason}
      </p>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...headingCellStyle, width: "45%" }}>Description</th>
            {taxed ? (
              <>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Tax</th>
              </>
            ) : null}
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Gross</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ line, source }) => (
            <tr key={line.id}>
              <td style={cellStyle}>
                {source.description}
                <div style={{ color: colors.muted, fontSize: 8 }}>
                  Unit {formatDecimal(source.unitPrice)}
                  {source.priceUnits > 1 ? ` / ${source.priceUnits}` : ""}
                  {taxed ? ` · GST ${source.taxRatePercent}%` : ""}
                </div>
              </td>
              {taxed ? (
                <>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {formatDecimal(line.taxableValue)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {formatDecimal(line.taxAmount)}
                  </td>
                </>
              ) : null}
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SummaryBox
        rows={[
          ...(taxed
            ? [
                { label: "Taxable", value: formatMoney(note.subtotal, invoice.currency) },
                { label: "Tax", value: formatMoney(note.taxTotal, invoice.currency) },
              ]
            : [
                {
                  label: "Value",
                  value: formatMoney(note.subtotal + note.taxTotal, invoice.currency),
                },
              ]),
          ...(note.roundOff !== ZERO
            ? [{ label: "Round off", value: formatMoney(note.roundOff, invoice.currency) }]
            : []),
          { label: "Credit total", value: formatMoney(note.total, invoice.currency), total: true },
        ]}
      />
    </DocumentShell>
  );
}

export function RefundDocument({
  invoice,
  refund,
  creditNote,
}: {
  invoice: Invoice;
  refund: Refund;
  creditNote: CreditNote;
}) {
  return (
    <DocumentShell document={invoice} title="Refund voucher" number={refund.refundNumber}>
      <SectionTitle>Refund details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(refund.businessDate) },
          {
            label: "Refunded to",
            value: (
              <>
                <span style={personName}>{invoice.patientName}</span>
                {invoice.patientMrn ? ` · MRN ${invoice.patientMrn}` : null}
              </>
            ),
          },
          { label: "Against invoice", value: invoice.invoiceNumber },
          { label: "Credit note", value: creditNote.creditNoteNumber },
          { label: "Method", value: methodLabel(refund.method) },
          ...(refund.reference ? [{ label: "Reference", value: refund.reference }] : []),
          { label: "Amount refunded", value: formatMoney(refund.amount, invoice.currency) },
        ]}
      />
    </DocumentShell>
  );
}

export function AdvanceReceiptDocument({ data }: { data: AdvanceBundle }) {
  const receipt = data.receipt;

  return (
    <DocumentShell
      document={receipt}
      title={advanceReceiptTitle(receipt)}
      number={receipt.receiptNumber}
    >
      <SectionTitle>Receipt details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(receipt.businessDate) },
          {
            label: "Received from",
            value: (
              <>
                <span style={personName}>{receipt.patientName}</span> · MRN {receipt.patientMrn}
              </>
            ),
          },
          ...(receipt.patientAddress
            ? [{ label: "Recipient address", value: receipt.patientAddress }]
            : []),
          { label: "Purpose", value: receipt.purpose },
          ...(receipt.orgGstin
            ? [
                { label: "Description", value: "Advance for exempt healthcare services" },
                { label: "Tax rate", value: "Exempt" },
                { label: "Tax amount", value: formatMoney(ZERO, receipt.currency) },
                ...registrationRows(receipt.orgGstin),
              ]
            : []),
          { label: "Method", value: methodLabel(receipt.method) },
          ...(receipt.reference ? [{ label: "Reference", value: receipt.reference }] : []),
          { label: "Received by", value: receipt.receivedByName },
          { label: "Amount received", value: formatMoney(receipt.amount, receipt.currency) },
        ]}
      />
      <p style={{ color: colors.muted, marginTop: 16 }}>
        Received towards future services. This is not an invoice.
      </p>
    </DocumentShell>
  );
}

export function AdvanceRefundDocument({
  data,
  refund,
}: {
  data: AdvanceBundle;
  refund: AdvanceBundle["refunds"][number];
}) {
  const receipt = data.receipt;

  return (
    <DocumentShell document={receipt} title="Refund voucher" number={refund.refundNumber}>
      <SectionTitle>Refund details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(refund.businessDate) },
          {
            label: "Refunded to",
            value: (
              <>
                <span style={personName}>{receipt.patientName}</span> · MRN {receipt.patientMrn}
              </>
            ),
          },
          { label: "Advance Receipt", value: receipt.receiptNumber },
          { label: "Method", value: methodLabel(refund.method) },
          ...(refund.reference ? [{ label: "Reference", value: refund.reference }] : []),
          { label: "Amount refunded", value: formatMoney(refund.amount, receipt.currency) },
        ]}
      />
    </DocumentShell>
  );
}
