import { formatDecimal } from "@hms/api/core/money";
import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";
import type { ComponentProps } from "react";

import {
  cellStyle,
  Details,
  DocumentShell,
  headingCellStyle,
  SectionTitle,
  SummaryBox,
  tableStyle,
} from "@/components/pdf/billing-documents";
import { mixedRateLabel } from "@/lib/invoice-print";
import { INTERIM_BILL_TITLE } from "@/lib/ipd-interim-bill";
import { formatMoney, ZERO } from "@/lib/money";

type Bill = Awaited<ReturnType<RouterClient<AppRouter>["ipd"]["previewInvoice"]>>;

const right = { ...cellStyle, textAlign: "right" } as const;

const rightHeading = { ...headingCellStyle, textAlign: "right" } as const;

/**
 * The running bill on paper during a stay: everything unbilled through `through`, with a
 * full last day. It takes no number and is neither an Invoice nor a Receipt.
 */
export function InterimBillDocument({
  bill,
  admissionNumber,
  facts,
  document,
}: {
  bill: Bill;
  admissionNumber: string;
  facts: { label: string; value: string }[];
  document: ComponentProps<typeof DocumentShell>["document"];
}) {
  const { pending, registered } = bill;
  const currency = document.currency;

  return (
    <DocumentShell
      document={document}
      title={INTERIM_BILL_TITLE}
      number={`IPD No. ${admissionNumber}`}
    >
      <section style={{ marginBottom: 20 }}>
        <Details rows={facts} />
      </section>

      <SectionTitle>Charges so far</SectionTitle>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={headingCellStyle}>Description</th>
            <th style={rightHeading}>Qty</th>
            <th style={rightHeading}>Rate</th>
            {registered ? <th style={rightHeading}>GST</th> : null}
            <th style={rightHeading}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {pending.lines.map((line, index) => (
            <tr key={line.chargeId ?? `${index}:${line.description}`}>
              <td style={cellStyle}>{line.description}</td>
              <td style={right}>{line.qty}</td>
              <td style={right}>
                {formatDecimal(line.unitPrice)}
                {line.priceUnits > 1 ? ` / ${line.priceUnits}` : ""}
              </td>
              {registered ? (
                <td style={right}>
                  {line.taxAmount === ZERO
                    ? mixedRateLabel(line)
                    : `${formatDecimal(line.taxAmount)} (${mixedRateLabel(line)})`}
                </td>
              ) : null}
              <td style={right}>{formatDecimal(line.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SummaryBox
        rows={[
          { label: "Subtotal", value: formatMoney(pending.subtotal, currency) },
          ...(pending.addedTaxTotal === ZERO
            ? []
            : [
                {
                  label: registered ? "GST added" : "Tax",
                  value: formatMoney(pending.addedTaxTotal, currency),
                },
              ]),
          { label: "Running bill", value: formatMoney(pending.grandTotal, currency), total: true },
        ]}
      />
    </DocumentShell>
  );
}
