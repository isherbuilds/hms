import type { ComponentProps } from "react";

import { colors, Details, DocumentShell, SectionTitle } from "@/components/pdf/billing-documents";
import type { Slip } from "@/lib/ipd-slips";

/** An admission or discharge slip; the IPD No. heads the page, so the rows skip it. */
export function SlipDocument({
  slip,
  admissionNumber,
  document,
}: {
  slip: Slip;
  admissionNumber: string;
  document: ComponentProps<typeof DocumentShell>["document"];
}) {
  return (
    <DocumentShell document={document} title={slip.title} number={`IPD No. ${admissionNumber}`}>
      <Details
        roomy
        rows={slip.facts
          .filter((fact) => fact.label !== "IPD No.")
          .map((fact) =>
            // Patient names are stored lower-case and capitalised wherever they print.
            fact.label === "Patient"
              ? {
                  ...fact,
                  value: <span style={{ textTransform: "capitalize" }}>{fact.value}</span>,
                }
              : fact,
          )}
      />
      {slip.signatures.length > 0 ? (
        <section style={{ breakInside: "avoid", marginTop: 24 }}>
          <SectionTitle>Clearances</SectionTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {slip.signatures.map((label) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${colors.border}`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  height: 72,
                  padding: 8,
                  flex: "1 1 40%",
                }}
              >
                <span>{label}</span>
                <span style={{ color: colors.muted, fontSize: 8 }}>Signature and date</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </DocumentShell>
  );
}
