import { buttonVariants } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { cn } from "@hms/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, FileTextIcon, ImageIcon, PaperclipIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { OpdAppointmentStatusBadge } from "@/components/opd-appointment";
import { ErrorNote, ListState, LoadMore, Panel } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

// A row carries only what tells visits apart; opening one fetches that appointment
// on its own. Every action on a visit belongs to the outpatient record.
const visitsQuery = (orgSlug: string, patientId: string) =>
  orpc.patient.visits.infiniteOptions({
    input: (cursor: { businessDate: string; id: string } | undefined) => ({
      orgSlug,
      patientId,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

function VisitPanel({
  orgSlug,
  appointmentId,
  currency,
}: {
  orgSlug: string;
  appointmentId: string;
  currency: string;
}) {
  const { timeZone } = useOrgDateTime();
  const detail = useQuery(orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }));

  if (detail.isPending) {
    return <p className="text-muted-foreground">Loading visit…</p>;
  }
  if (detail.isError) {
    return <ErrorNote title="Could not load this visit" error={detail.error} />;
  }

  const { charges, prescriptions } = detail.data;
  const billable = charges.filter((charge) => charge.status !== "voided");

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <p className="min-h-6 text-xs text-muted-foreground">Prescriptions and reports</p>
        {prescriptions.length === 0 ? (
          <p className="text-muted-foreground">Nothing attached.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {prescriptions.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() =>
                    openOrgFile(orgSlug, file.fileId).catch((error: unknown) =>
                      toast.error(errorMessage(error, "Could not open that file")),
                    )
                  }
                  className={cn(
                    "-mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                    "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
                  )}
                >
                  {file.mimeType?.startsWith("image/") ? (
                    <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <p className="min-h-6 text-xs text-muted-foreground">Charges</p>
        {billable.length === 0 ? (
          <p className="text-muted-foreground">Nothing was charged for this visit.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-36 text-right">Unit price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billable.map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell className="font-medium">{charge.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(charge.unitPrice, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          className={buttonVariants({ size: "xs", variant: "outline" })}
          to="/$orgSlug/opd/$appointmentId"
          params={{ orgSlug, appointmentId }}
        >
          Open visit record
        </Link>
        <p className="text-muted-foreground">
          Created {formatDateTime(detail.data.appointment.createdAt, timeZone)}
        </p>
      </div>
    </div>
  );
}

type VisitRow = {
  id: string;
  businessDate: string;
  status: "booked" | "checked_in" | "cancelled" | "no_show";
  tokenNumber: number | null;
  practitionerName: string;
  departmentName: string;
  prescriptionCount: number;
  outstanding: string;
};

function VisitAccordionRow({
  orgSlug,
  visit,
  currency,
}: {
  orgSlug: string;
  visit: VisitRow;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const due = Number(visit.outstanding) !== 0;

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
          "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
        )}
      >
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
        <span className="w-24 shrink-0 whitespace-nowrap">
          {formatBusinessDate(visit.businessDate)}
        </span>
        <span className="w-16 shrink-0 font-mono text-muted-foreground tabular-nums">
          {visit.tokenNumber ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {visit.departmentName}
          <span className="pl-2 text-muted-foreground">{visit.practitionerName}</span>
        </span>
        {visit.prescriptionCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <PaperclipIcon className="size-3.5" />
            {visit.prescriptionCount}
          </span>
        ) : null}
        <OpdAppointmentStatusBadge status={visit.status} />
        <span
          className={cn(
            "w-20 shrink-0 text-right tabular-nums",
            due ? "text-clinical-alert" : "text-muted-foreground",
          )}
        >
          {due ? formatMoney(visit.outstanding, currency) : "—"}
        </span>
      </button>

      {/* Animating grid-template-rows is the honest way to open a panel of
          unknown height; the row is the only layout dependent. */}
      <div
        data-open={open || undefined}
        className={cn(
          "grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out",
          "data-open:grid-rows-[1fr] motion-reduce:transition-none",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pt-1 pb-4 pl-9">
            {open ? (
              <VisitPanel orgSlug={orgSlug} appointmentId={visit.id} currency={currency} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PatientVisits({
  orgSlug,
  patientId,
  currency,
}: {
  orgSlug: string;
  patientId: string;
  currency: string;
}) {
  const visits = useInfiniteQuery(visitsQuery(orgSlug, patientId));
  const rows = visits.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel
      label="Visits · open a row to see its files and charges"
      footer={<LoadMore query={visits} shown={rows.length} />}
    >
      <ListState
        query={visits}
        errorTitle="Could not load visits"
        isEmpty={rows.length === 0}
        empty="This patient has no visits yet."
      >
        {rows.map((visit) => (
          <VisitAccordionRow key={visit.id} orgSlug={orgSlug} visit={visit} currency={currency} />
        ))}
      </ListState>
    </Panel>
  );
}
