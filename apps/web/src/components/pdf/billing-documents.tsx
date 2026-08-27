import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";
import type { CSSProperties, ReactNode } from "react";

export type InvoiceBundle = Awaited<ReturnType<RouterClient<AppRouter>["billing"]["getInvoice"]>>;
type Invoice = InvoiceBundle["invoice"];
type Payment = InvoiceBundle["payments"][number];
type CreditNote = InvoiceBundle["creditNotes"][number];
type Refund = InvoiceBundle["refunds"][number];

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

function formatBusinessDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Display-only grouping: all persisted arithmetic remains exact decimal-string math. */
function money(value: string | number, currency: string): string {
  const amount = Number(value);
  const grouped = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `${amount < 0 ? "-" : ""}${currency} ${grouped}`;
}

function splitTax(value: string): { cgst: string; sgst: string } {
  const paise = Math.round(Number(value) * 100);
  const cgst = Math.floor((paise + 1) / 2);
  return { cgst: (cgst / 100).toFixed(2), sgst: ((paise - cgst) / 100).toFixed(2) };
}

function DocumentShell({
  invoice,
  title,
  number,
  thermal = false,
  children,
}: {
  invoice: Invoice;
  title: string;
  number: string;
  thermal?: boolean;
  children: ReactNode;
}) {
  const letterhead = [
    invoice.orgAddress.replace(/\n/g, ", ").trim(),
    invoice.orgTaxId ? `Tax ID ${invoice.orgTaxId}` : "",
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
            {invoice.orgLegalName}
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

  if (layout === "thermal") {
    return (
      <DocumentShell invoice={invoice} title="Invoice" number={invoice.invoiceNumber} thermal>
        <Details
          rows={[
            { label: "Issued", value: formatBusinessDate(invoice.businessDate) },
            { label: "Patient", value: invoice.patientName },
            { label: "MRN", value: invoice.patientMrn },
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
                <span>{money(line.gross, currency)}</span>
              </div>
              <div style={{ color: colors.muted, fontSize: 8 }}>
                {`Unit ${line.unitPrice} · taxable ${line.taxableValue} · tax ${line.taxAmount} @ ${line.taxRatePercent}%`}
              </div>
            </div>
          ))}
        </section>
        <Details
          roomy
          rows={[
            { label: "Subtotal", value: money(invoice.subtotal, currency) },
            { label: "Discount", value: money(invoice.discountAmount, currency) },
            { label: "Tax", value: money(invoice.taxTotal, currency) },
            { label: "Grand total", value: money(invoice.grandTotal, currency) },
          ]}
        />
      </DocumentShell>
    );
  }

  const taxSummary = Array.from(
    lines.reduce((groups, line) => {
      const current = groups.get(line.taxRatePercent) ?? { taxable: 0, tax: 0 };
      current.taxable += Math.round(Number(line.taxableValue) * 100);
      current.tax += Math.round(Number(line.taxAmount) * 100);
      groups.set(line.taxRatePercent, current);
      return groups;
    }, new Map<string, { taxable: number; tax: number }>()),
  );

  return (
    <DocumentShell invoice={invoice} title="Invoice" number={invoice.invoiceNumber}>
      <section style={{ display: "flex", gap: 28, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Invoice details</SectionTitle>
          <Details
            rows={[
              { label: "Invoice #", value: invoice.invoiceNumber },
              { label: "Issued", value: formatBusinessDate(invoice.businessDate) },
              { label: "Currency", value: currency },
            ]}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SectionTitle>Billed to</SectionTitle>
          <div style={{ fontWeight: 700 }}>{invoice.patientName}</div>
          <div style={{ color: colors.muted }}>MRN {invoice.patientMrn}</div>
          <div style={{ color: colors.muted }}>{invoice.patientPhone}</div>
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
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.unitPrice}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.allocatedDiscount}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxableValue}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxRatePercent}%</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxAmount}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.gross}</td>
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
                const split = splitTax((amounts.tax / 100).toFixed(2));
                return (
                  <tr key={rate}>
                    <td style={cellStyle}>{rate}%</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {(amounts.taxable / 100).toFixed(2)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{split.cgst}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{split.sgst}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <SummaryBox
        rows={[
          { label: "Subtotal", value: money(invoice.subtotal, currency) },
          { label: "Discount", value: money(invoice.discountAmount, currency) },
          { label: "Tax", value: money(invoice.taxTotal, currency) },
          { label: "Grand total", value: money(invoice.grandTotal, currency), total: true },
        ]}
      />
    </DocumentShell>
  );
}

export function ReceiptDocument({ invoice, payment }: { invoice: Invoice; payment: Payment }) {
  return (
    <DocumentShell invoice={invoice} title="Payment receipt" number={payment.receiptNumber}>
      <SectionTitle>Receipt details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(payment.businessDate) },
          { label: "Received from", value: `${invoice.patientName} · MRN ${invoice.patientMrn}` },
          { label: "Against invoice", value: invoice.invoiceNumber },
          { label: "Method", value: payment.method.toUpperCase() },
          ...(payment.reference ? [{ label: "Reference", value: payment.reference }] : []),
          { label: "Amount received", value: money(payment.amount, invoice.currency) },
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
    <DocumentShell invoice={invoice} title="Credit note" number={note.creditNoteNumber}>
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
          <strong>{invoice.patientName}</strong>
          <div style={{ color: colors.muted }}>MRN {invoice.patientMrn}</div>
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
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxableValue}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.taxAmount}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>{line.gross}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SummaryBox
        rows={[
          { label: "Taxable", value: money(note.subtotal, invoice.currency) },
          { label: "Tax", value: money(note.taxTotal, invoice.currency) },
          { label: "Credit total", value: money(note.total, invoice.currency), total: true },
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
    <DocumentShell invoice={invoice} title="Refund voucher" number={refund.refundNumber}>
      <SectionTitle>Refund details</SectionTitle>
      <Details
        roomy
        rows={[
          { label: "Issued", value: formatBusinessDate(refund.businessDate) },
          { label: "Refunded to", value: `${invoice.patientName} · MRN ${invoice.patientMrn}` },
          { label: "Against invoice", value: invoice.invoiceNumber },
          { label: "Credit note", value: creditNote.creditNoteNumber },
          { label: "Method", value: refund.method.toUpperCase() },
          ...(refund.reference ? [{ label: "Reference", value: refund.reference }] : []),
          { label: "Amount refunded", value: money(refund.amount, invoice.currency) },
        ]}
      />
    </DocumentShell>
  );
}
