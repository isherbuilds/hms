import { Button } from "@hms/ui/components/button";
import { Separator } from "@hms/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { PrinterIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  CheckInOpdAppointmentDialog,
  RescheduleOpdAppointmentDialog,
} from "@/components/opd-appointment-dialogs";
import { useConfirm } from "@/components/confirm-dialog";
import { CancelOpdAppointmentDialog, useOpdStatusActions } from "@/components/opd-appointment";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatMoney } from "@/lib/money";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { patientAgeLabel } from "@/lib/patient-age";

import { OpdRecordDescription, OpdRecordFacts, OpdRecordSummary, OpdRecordTabs } from "./route";

/** Extensions worth trusting when the browser reports an empty File.type. */
const SCAN_EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
};

/**
 * Resolves the MIME type `appointment.attachPrescription` will accept, or null.
 * Browsers report an empty `File.type` for some valid scans; uploading those
 * unresolved would finalize an orphan file that attach then rejects.
 */
function prescriptionMimeType(file: File): string | null {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) {
    return file.type;
  }
  if (file.type !== "") {
    return null;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SCAN_EXTENSION_TYPES[extension] ?? null;
}

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId/")({
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    await Promise.all([
      loadRouteQuery(
        queryClient.fetchQuery(orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } })),
      ),
      queryClient.prefetchQuery(orpc.settings.get.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: OpdAppointmentDetailRoute,
});

function OpdAppointmentDetailRoute() {
  const { orgSlug, appointmentId } = Route.useParams();
  const { timeZone, today } = useOrgDateTime();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const detailQuery = {
    ...orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  };
  const detail = useQuery(detailQuery);
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));
  const { checkIn, markNoShow } = useOpdStatusActions(orgSlug);
  const changingStatus = checkIn.isPending || markNoShow.isPending;

  if (detail.isPending || settings.isPending) {
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <PageBody className="mx-auto w-full max-w-5xl" />
      </>
    );
  }

  if (detail.isError || settings.isError) {
    const error = detail.error ?? settings.error;
    return (
      <>
        <PageHeader title="Outpatient appointment" />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />
        <ErrorNote title="Could not load outpatient appointment" detail={error?.message} inset />
      </>
    );
  }

  const { appointment, patient, practitioner, department, charges, prescriptions } = detail.data;
  const consultCharge = charges.find((charge) => charge.sourceType === "consult_fee");
  const age = patient
    ? `${patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)} years`
    : null;
  // A booked appointment has no token or patient yet — both arrive at check-in.
  const hasToken = appointment.tokenNumber != null;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col print:hidden">
        <PageHeader
          title="Outpatient appointment"
          description={<OpdRecordDescription orgSlug={orgSlug} record={detail.data} />}
          action={
            <>
              <StaleDataNotice dataUpdatedAt={detail.dataUpdatedAt} />
              <Button disabled={!hasToken || !patient} onClick={() => window.print()}>
                <PrinterIcon data-icon="inline-start" />
                Print slip
              </Button>
            </>
          }
        />
        <OpdRecordTabs orgSlug={orgSlug} appointmentId={appointmentId} />

        <PageBody className="mx-auto w-full max-w-5xl">
          <OpdRecordSummary
            record={detail.data}
            action={
              appointment.status === "booked" ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    disabled={changingStatus}
                    onClick={() =>
                      appointment.patientId
                        ? checkIn.mutate({ orgSlug, appointmentId })
                        : setCheckInOpen(true)
                    }
                  >
                    Check in
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setRescheduleOpen(true)}>
                    Reschedule
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={changingStatus}
                    onClick={() =>
                      confirm({
                        title: "Mark as no show?",
                        description:
                          "The caller did not arrive. A no show cannot be reopened — rebook if they turn up later.",
                        confirmLabel: "Mark no show",
                        run: () => markNoShow.mutate({ orgSlug, appointmentId }),
                      })
                    }
                  >
                    No show
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={changingStatus}
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : appointment.status === "checked_in" ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={changingStatus}
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel
                </Button>
              ) : null
            }
          />

          <Separator />
          <OpdRecordFacts record={detail.data} />

          <Separator />
          <PrescriptionDocuments
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            prescriptions={prescriptions}
            disabled={appointment.status === "cancelled"}
          />
        </PageBody>
      </div>

      {hasToken && patient ? (
        <article
          data-opd-slip
          className="hidden bg-white p-6 text-xs leading-tight text-black print:block print:p-0"
        >
          <header className="border-b border-black pb-3 text-center">
            <h1 className="text-base font-bold">{settings.data.legalName}</h1>
            {settings.data.address ? (
              <p className="mt-1 whitespace-pre-line">{settings.data.address}</p>
            ) : null}
          </header>
          <div className="border-b border-black py-4 text-center">
            <p className="uppercase tracking-[0.18em]">Outpatient token</p>
            <p className="mt-1 text-5xl font-bold tabular-nums">{appointment.tokenNumber}</p>
          </div>
          <dl className="grid grid-cols-[28mm_1fr] gap-x-3 gap-y-2 border-b border-black py-4">
            <dt className="font-semibold">Outpatient appointment</dt>
            <dd>{formatDateTime(appointment.arrivedAt ?? appointment.createdAt, timeZone)}</dd>
            <dt className="font-semibold">Patient</dt>
            <dd>
              {patient.name} · {patient.mrn} · {age} · {patient.sex}
            </dd>
            <dt className="font-semibold">Practitioner</dt>
            <dd>{practitioner.name}</dd>
            <dt className="font-semibold">Department</dt>
            <dd>{department.name}</dd>
          </dl>
          {consultCharge ? (
            <div className="flex items-center justify-between gap-4 py-4">
              <span>{consultCharge.description}</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(consultCharge.unitPrice, settings.data.currency)}
              </span>
            </div>
          ) : null}
        </article>
      ) : null}

      <style>{`@media print {
        @page { size: A5 portrait; margin: 10mm; }
        body * { visibility: hidden !important; }
        [data-opd-slip], [data-opd-slip] * { visibility: visible !important; }
        [data-opd-slip] { position: fixed; inset: 0; width: 100%; }
      }`}</style>

      <ClientOnly fallback={null}>
        {cancelOpen ? (
          <CancelOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            onClose={() => setCancelOpen(false)}
          />
        ) : null}
        {rescheduleOpen ? (
          <RescheduleOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            scheduledFor={appointment.scheduledFor}
            onClose={() => setRescheduleOpen(false)}
          />
        ) : null}
        {checkInOpen ? (
          <CheckInOpdAppointmentDialog
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            callerName={appointment.callerName}
            callerPhone={appointment.callerPhone}
            onClose={() => setCheckInOpen(false)}
          />
        ) : null}
        {confirmDialog}
      </ClientOnly>
    </>
  );
}

function PrescriptionDocuments({
  orgSlug,
  appointmentId,
  prescriptions,
  disabled,
}: {
  orgSlug: string;
  appointmentId: string;
  prescriptions: Array<{
    id: string;
    fileId: string;
    name: string;
    mimeType: string | null;
    size: number;
    createdAt: Date | string;
  }>;
  disabled: boolean;
}) {
  const { timeZone } = useOrgDateTime();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.opd.get.key({ input: { orgSlug, appointmentId } }),
      }),
      // Uploads create a ready file and attach/detach write audit rows, so the
      // file-domain views must not keep serving their 60s-stale caches.
      queryClient.invalidateQueries({
        queryKey: orpc.file.list.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.audit.list.key({ input: { orgSlug } }),
      }),
    ]);

  const upload = async (file: File) => {
    const mimeType = prescriptionMimeType(file);
    if (!mimeType) {
      toast.error("Only image or PDF scans can be attached");
      return;
    }
    setUploading(true);
    try {
      const fileId = await uploadOrgFile(orgSlug, file, mimeType);
      await orpc.opd.attachPrescription.call({ orgSlug, appointmentId, fileId });
      await refresh();
      toast.success("Prescription scan attached");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach prescription scan");
    } finally {
      setUploading(false);
    }
  };

  const open = async (fileId: string) => {
    try {
      await openOrgFile(orgSlug, fileId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open prescription scan");
    }
  };

  const remove = async (attachmentId: string) => {
    setRemovingId(attachmentId);
    try {
      await orpc.opd.detachPrescription.call({ orgSlug, attachmentId });
      await refresh();
      toast.success("Prescription scan removed; the private file was kept");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove prescription scan");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-muted-foreground">Paper prescription</h2>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon data-icon="inline-start" />
          {uploading ? "Uploading…" : "Attach scan"}
        </Button>
      </div>

      {prescriptions.length === 0 ? (
        <p className="text-muted-foreground">
          No scan attached. Keep the doctor's signed image or PDF as the source record.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="w-24">Size</TableHead>
              <TableHead className="w-44">Captured</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prescriptions.map((prescription) => (
              <TableRow key={prescription.id}>
                <TableCell>
                  <p className="font-medium">{prescription.name}</p>
                  <p className="text-muted-foreground">{prescription.mimeType}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatFileSize(prescription.size)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(prescription.createdAt, timeZone)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => void open(prescription.fileId)}
                    >
                      Open
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${prescription.name}`}
                      disabled={removingId !== null}
                      onClick={() => void remove(prescription.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
