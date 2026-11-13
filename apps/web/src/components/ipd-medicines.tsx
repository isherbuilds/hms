import { computeInvoiceLines } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@hms/ui/components/field";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DataList, ListState, Panel } from "@/components/page";
import { PharmacyBatchPicker, type SaleLine } from "@/components/pharmacy-batch-picker";
import { useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { formatBusinessDate, formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { formatStockQty, stockUnitPlural } from "@/lib/pharmacy-labels";

/**
 * Plain words for the server's `supply`: medicine given as part of the stay is an
 * exempt composite healthcare supply; one sold on its own carries the pack's GST.
 */
const SUPPLIES = [
  ["bundled", "Part of treatment (no GST)"],
  ["independent", "Sold separately (GST as on pack)"],
] as const;

type Supply = (typeof SUPPLIES)[number][0];

// `capped`: the desk asked for more than the shelf holds, so the form says what it did.
type IssueLine = SaleLine & { supply: Supply; capped?: boolean };

export const admissionIssuesQuery = (orgSlug: string, admissionId: string) =>
  orpc.pharmacy.listAdmissionIssues.queryOptions({ input: { orgSlug, admissionId } });

export function AdmissionMedicines({
  orgSlug,
  admissionId,
  action,
}: {
  orgSlug: string;
  admissionId: string;
  /** The issue button, when this member may issue to this Admission now. */
  action?: ReactNode;
}) {
  const { timeZone } = useOrgDateTime();
  const issues = useQuery(admissionIssuesQuery(orgSlug, admissionId));

  const rows = (issues.data?.issues ?? []).flatMap((issue) =>
    issue.lines.map((line) => ({ ...line, issue })),
  );

  return (
    <Panel label="Medicines issued" action={action} minHeight="">
      <ListState
        query={issues}
        errorTitle="Could not load medicines issued"
        isEmpty={rows.length === 0}
        empty="No medicines issued yet"
      >
        <DataList
          columns={[
            {
              head: "Medicine",
              cell: (row) => <span className="capitalize">{row.productName}</span>,
            },
            {
              head: "Batch",
              cell: (row) => (
                <span className="md:whitespace-nowrap">
                  <span className="font-mono">{row.batchNumber}</span>
                  {row.expiryDate ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · expires {formatBusinessDate(row.expiryDate)}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              head: "Qty",
              cell: (row) => <span className="tabular-nums">{row.qty}</span>,
              className: "text-right",
              mobile: "title",
            },
            {
              head: "Issued",
              cell: (row) => (
                <span className="tabular-nums md:whitespace-nowrap">
                  {formatDateTime(row.issue.createdAt, timeZone)} · {row.issue.issuedByName}
                </span>
              ),
            },
            {
              head: "Prescriber",
              cell: (row) => row.issue.prescriberName ?? "—",
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          wrap
        />
      </ListState>
    </Panel>
  );
}

// Mounted per open, so the cart starts empty without an effect.
export function IssueMedicinesDialog({
  orgSlug,
  admission,
  onClose,
}: {
  orgSlug: string;
  admission: { id: string; chargeRevision: number };
  onClose: () => void;
}) {
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // Without a GSTIN every medicine is part of treatment, so the choice is not offered.
  const gstRegistered = useMembership(orgSlug, (membership) => membership.gstRegistered);
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [prescriberName, setPrescriberName] = useState("");
  const [attempted, setAttempted] = useState(false);

  // Every issue is priced at the batch MRP; the supply only decides the GST inside it.
  const priced = computeInvoiceLines(
    lines.map((line) => ({
      chargeId: line.batchId,
      description: line.productName,
      qty: line.qty,
      unitPrice: line.mrp,
      priceUnits: line.mrpUnits,
      taxRatePercent: line.supply === "bundled" ? "0.00" : line.taxRatePercent,
      taxCode: null,
      priceBasis: "inclusive" as const,
    })),
    ZERO,
    { roundToRupee: false },
  );

  const scheduleH1 = lines.some((line) => line.schedule === "h1");

  const blocked =
    lines.length === 0
      ? "Add a medicine to issue."
      : scheduleH1 && prescriberName.trim() === ""
        ? "A Schedule H1 medicine needs the prescriber."
        : undefined;

  const issue = useMutation(
    orpc.pharmacy.issueToAdmission.mutationOptions({
      onSuccess: () => {
        toast.success("Medicines issued");
        onClose();
      },
    }),
  );

  const update = (batchId: string, patch: Partial<IssueLine>) =>
    setLines((current) =>
      current.map((line) => (line.batchId === batchId ? { ...line, ...patch } : line)),
    );

  const commitQty = (line: IssueLine, input: HTMLInputElement) => {
    // Whole units, and never more than the shelf holds: the server refuses more.
    const wanted = Math.max(1, Math.trunc(input.valueAsNumber) || 1);
    const qty = Math.min(line.shelfQty, wanted);
    input.value = String(qty);
    update(line.batchId, { qty, capped: wanted > line.shelfQty });
  };

  const submit = () => {
    setAttempted(true);

    if (blocked) return;

    issue.mutate({
      orgSlug,
      admissionId: admission.id,
      expectedChargeRevision: admission.chargeRevision,
      lines: lines.map((line) => ({ batchId: line.batchId, qty: line.qty, supply: line.supply })),
      prescriberName: prescriberName.trim() || undefined,
    });
  };

  // A refusal keeps the lines, so a shelf that ran short costs one edit, not the cart.
  // The page unmounts this form once the refreshed Admission can no longer take issues.
  const refusal = issue.error
    ? errorMessage(issue.error, "Could not issue the medicines")
    : undefined;

  const prescriberProblem =
    attempted && scheduleH1 && prescriberName.trim() === ""
      ? "A Schedule H1 medicine needs the prescriber."
      : undefined;

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(open) => (open || issue.isPending ? undefined : onClose())}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Issue medicines</DialogTitle>
            <DialogDescription>
              Stock leaves the shelf now. The medicines go on the admission bill at MRP.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <fieldset disabled={issue.isPending} className="contents">
              <PharmacyBatchPicker
                orgSlug={orgSlug}
                chosen={new Set(lines.map((line) => line.batchId))}
                onAdd={(batch) =>
                  setLines((current) => [...current, { ...batch, qty: 1, supply: "bundled" }])
                }
              />

              {lines.length > 0 ? (
                <ul className="grid gap-2">
                  {lines.map((line, index) => (
                    <li
                      key={line.batchId}
                      className="grid min-w-0 gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium capitalize">
                            {line.productName}
                            {line.pack ? (
                              <span className="text-muted-foreground"> · {line.pack}</span>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground">
                            <span className="font-mono">{line.batchNumber}</span> ·{" "}
                            {line.expiryDate
                              ? `expires ${formatBusinessDate(line.expiryDate)}`
                              : "no expiry"}{" "}
                            · {formatStockQty({ ...line, qty: line.shelfQty })} on shelf
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="destructive"
                          aria-label={`Remove ${line.productName}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((each) => each.batchId !== line.batchId),
                            )
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                      <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
                        {/* Counted in the smallest unit: 1 is one tablet, not one strip. */}
                        <label className="grid gap-1 text-muted-foreground">
                          Qty ({stockUnitPlural(line.stockUnit)})
                          <Input
                            key={`${line.batchId}:${line.qty}`}
                            type="number"
                            min={1}
                            max={line.shelfQty}
                            step={1}
                            defaultValue={line.qty}
                            aria-label={`${line.productName} quantity in ${stockUnitPlural(line.stockUnit)}`}
                            className="tabular-nums"
                            onBlur={(event) => commitQty(line, event.currentTarget)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              commitQty(line, event.currentTarget);
                            }}
                          />
                        </label>
                        {gstRegistered ? (
                          <NativeSelect
                            aria-label={`How ${line.productName} is supplied`}
                            value={line.supply}
                            onChange={(event) => {
                              const supply = SUPPLIES.find(
                                ([value]) => value === event.target.value,
                              );

                              if (supply) update(line.batchId, { supply: supply[0] });
                            }}
                          >
                            {SUPPLIES.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : null}
                        <p className="col-span-2 text-right tabular-nums sm:col-span-1 sm:self-center">
                          {formatMoney(priced.lines[index]?.gross ?? ZERO, currency)}
                        </p>
                        {line.capped ? (
                          <p role="status" className="col-span-full text-destructive">
                            Only {formatStockQty({ ...line, qty: line.shelfQty })} on the shelf, so
                            the quantity is now {line.shelfQty}.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              <Field data-invalid={Boolean(prescriberProblem) || undefined}>
                <FieldLabel htmlFor="issue-prescriber">
                  Prescriber
                  {scheduleH1 ? <span className="text-destructive">*</span> : null}
                </FieldLabel>
                <Input
                  id="issue-prescriber"
                  name="prescriberName"
                  value={prescriberName}
                  aria-invalid={Boolean(prescriberProblem)}
                  aria-describedby={prescriberProblem ? "issue-prescriber-error" : undefined}
                  onChange={(event) => setPrescriberName(event.target.value)}
                />
                <FieldError id="issue-prescriber-error">{prescriberProblem}</FieldError>
              </Field>

              {refusal ? (
                <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
                  {refusal}
                </p>
              ) : null}

              <DialogFooter className="items-center sm:justify-between">
                <p className="tabular-nums">
                  Total{" "}
                  <span className="font-medium">{formatMoney(priced.grandTotal, currency)}</span>
                </p>
                <SubmitButton
                  isSubmitting={issue.isPending}
                  aria-disabled={blocked !== undefined || undefined}
                >
                  Issue
                </SubmitButton>
              </DialogFooter>
              {attempted && blocked && !prescriberProblem ? (
                <p className="text-right text-muted-foreground">{blocked}</p>
              ) : null}
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
