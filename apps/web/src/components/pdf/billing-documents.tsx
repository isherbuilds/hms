import { splitGst } from "@hms/api/lib/invoice-math";
import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";
import type { CSSProperties, ReactNode } from "react";
import { formatBusinessDate } from "@/lib/business-date";
import { formatDecimal } from "@hms/api/core/money";
import { formatMoney, ZERO } from "@/lib/money";
import { methodLabel } from "@/lib/settlement";

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
  "orgAddress" | "orgLegalName" | "orgTaxId" | "currency" | "patientName" | "patientMrn"
>;

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
    document.orgTaxId ? `Tax ID ${document.orgTaxId}` : "",
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
        <div>
          <h1 style={{ fontSize: thermal ? 15 : 18, lineHeight: 1.2, margin: 0 }}>
            {document.orgLegalName}
          </h1>
          {letterhead ? (
            <p style={{ color: colors.muted, fontSize: 8, margin: "4px 0 0" }}>{letterhead}</p>
          ) : null}
        </div>
        <div style={{ marginTop: thermal ? 10 : 0, textAlign: thermal ? "center" : "right" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{title}</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{number}</div>
        </div>
      </header>
      {children}
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
  const separator = (invoice.patientGuardian?.indexOf(" ") ?? -1) + 1;

  const guardian = invoice.patientGuardian ? (
    <>
      {invoice.patientGuardian.slice(0, separator)}
      <span style={personName}>{invoice.patientGuardian.slice(separator)}</span>
    </>
  ) : null;

  if (layout === "thermal") {
    return (
      <DocumentShell document={invoice} title="Invoice" number={invoice.invoiceNumber} thermal>
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
                {`Unit ${formatDecimal(line.unitPrice)}${line.priceUnits > 1 ? ` / ${line.priceUnits}` : ""} · taxable ${formatDecimal(line.taxableValue)} · tax ${formatDecimal(line.taxAmount)} @ ${line.taxRatePercent}%`}
              </div>
            </div>
          ))}
        </section>
        <Details
          roomy
          rows={[
            { label: "Subtotal", value: formatMoney(invoice.subtotal, currency) },
            { label: "Discount", value: formatMoney(invoice.discountAmount, currency) },
            { label: "Tax", value: formatMoney(invoice.taxTotal, currency) },
            ...(invoice.roundOff !== ZERO
              ? [{ label: "Round off", value: formatMoney(invoice.roundOff, currency) }]
              : []),
            { label: "Grand total", value: formatMoney(invoice.grandTotal, currency) },
          ]}
        />
      </DocumentShell>
    );
  }

  const taxSummary = Array.from(
    lines.reduce((groups, line) => {
      const current = groups.get(line.taxRatePercent) ?? {
        taxable: ZERO,
        tax: ZERO,
      };

      current.taxable += line.taxableValue;
      current.tax += line.taxAmount;
      groups.set(line.taxRatePercent, current);

      return groups;
    }, new Map<string, { taxable: bigint; tax: bigint }>()),
  );

  return (
    <DocumentShell document={invoice} title="Invoice" number={invoice.invoiceNumber}>
      <section style={{ display: "flex", gap: 28, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Invoice details</SectionTitle>
          <Details
            rows={[
              { label: "Invoice #", value: invoice.invoiceNumber },
              { label: "Issued", value: formatBusinessDate(invoice.businessDate) },
              { label: "Issued by", value: invoice.issuedByName },
              { label: "Currency", value: currency },
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
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Unit</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Discount</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Rate</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Tax</th>
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
              <td style={{ ...cellStyle, textAlign: "right" }}>
                {formatDecimal(line.taxableValue)}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxRatePercent}%</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.taxAmount)}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {currency === "INR" && taxSummary.length > 0 ? (
        <section style={{ breakInside: "avoid", marginTop: 18 }}>
          <SectionTitle>Tax summary</SectionTitle>
          <table style={{ ...tableStyle, width: 350 }}>
            <thead>
              <tr>
                <th style={headingCellStyle}>Rate</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>CGST</th>
                <th style={{ ...headingCellStyle, textAlign: "right" }}>SGST</th>
              </tr>
            </thead>
            <tbody>
              {taxSummary.map(([rate, amounts]) => {
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
      ) : null}

      <SummaryBox
        rows={[
          { label: "Subtotal", value: formatMoney(invoice.subtotal, currency) },
          { label: "Discount", value: formatMoney(invoice.discountAmount, currency) },
          { label: "Tax", value: formatMoney(invoice.taxTotal, currency) },
          ...(invoice.roundOff !== ZERO
            ? [{ label: "Round off", value: formatMoney(invoice.roundOff, currency) }]
            : []),
          { label: "Grand total", value: formatMoney(invoice.grandTotal, currency), total: true },
        ]}
      />
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
  const descriptions = new Map(invoiceLines.map((line) => [line.id, line.description]));

  const rows = note.lines.map((line) => {
    const description = descriptions.get(line.invoiceLineId);

    if (!description) {
      throw new Error(
        `Invoice line ${line.invoiceLineId} is missing from ${invoice.invoiceNumber}`,
      );
    }

    return { line, description };
  });

  return (
    <DocumentShell document={invoice} title="Credit note" number={note.creditNoteNumber}>
      <section style={{ display: "flex", gap: 28, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Credit note details</SectionTitle>
          <Details
            rows={[
              { label: "Credit note #", value: note.creditNoteNumber },
              { label: "Issued", value: formatBusinessDate(note.businessDate) },
              { label: "Against invoice", value: invoice.invoiceNumber },
            ]}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SectionTitle>Issued to</SectionTitle>
          <strong style={personName}>{invoice.patientName}</strong>
          {invoice.patientMrn ? (
            <div style={{ color: colors.muted }}>MRN {invoice.patientMrn}</div>
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
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Taxable</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Tax</th>
            <th style={{ ...headingCellStyle, textAlign: "right" }}>Gross</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ line, description }) => (
            <tr key={line.id}>
              <td style={cellStyle}>{description}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                {formatDecimal(line.taxableValue)}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.taxAmount)}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{formatDecimal(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SummaryBox
        rows={[
          { label: "Taxable", value: formatMoney(note.subtotal, invoice.currency) },
          { label: "Tax", value: formatMoney(note.taxTotal, invoice.currency) },
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
    <DocumentShell document={receipt} title="Advance Receipt" number={receipt.receiptNumber}>
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
          { label: "Purpose", value: receipt.purpose },
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
