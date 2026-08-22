import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FileTextIcon, PrinterIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  CheckInOpdAppointmentDialog,
  RescheduleOpdAppointmentDialog,
} from "@/components/book-opd-appointment-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import {
  CancelOpdAppointmentDialog,
  MarkLeftUnseenOpdAppointmentDialog,
  OpdAppointmentStatusBadge,
  useOpdStatusActions,
} from "@/components/opd-appointment";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { StaleDataNotice } from "@/components/stale-data-notice";
import { formatMoney } from "@/lib/money";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { patientAgeYears } from "@/lib/patient-age";

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
  const [leftUnseenOpen, setLeftUnseenOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const detailQuery = {
    ...orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } }),
    ...OPERATIONAL_REFETCH,
  };
  const detail = useQuery(detailQuery);
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  const { startConsultation, complete, checkIn, markNoShow } = useOpdStatusActions(orgSlug);
  const changingStatus =
    startConsultation.isPending || complete.isPending || checkIn.isPending || markNoShow.isPending;

  if (detail.isPending || settings.isPending) {
    // A swallowed prefetch failure leaves this pending for a whole refetch, and
    // a blank screen reads as a broken terminal. Static blocks, not a shimmer:
    // this is an all-day console and the wait is usually one frame.
    return (
      <>
        <PageHeader title="OPD appointment" />
        <PageBody className="max-w-5xl">
          <div role="status" aria-label="Loading OPD appointment" className="flex flex-col gap-4">
            <div className="h-24 bg-muted" />
            <div className="h-40 bg-muted" />
          </div>
        </PageBody>
      </>
    );
  }

  if (detail.isError || settings.isError) {
    const error = detail.error ?? settings.error;
    return (
      <>
        <PageHeader title="OPD appointment" />
        <ErrorNote title="Could not load OPD appointment" detail={error?.message} inset />
      </>
    );
  }

  const { appointment, patient, practitioner, department, charges, prescriptions } = detail.data;
  const consultCharge = charges.find((charge) => charge.sourceType === "consult_fee");
  const ageYears = patient ? patientAgeYears(patient.dateOfBirth, patient.ageYears, today) : null;
  const age = ageYears === null ? "Age not recorded" : `${ageYears} years`;
  // A booked appointment has no token or patient yet — both arrive at check-in.
  const hasToken = appointment.tokenNumber != null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={hasToken ? `Token ${appointment.tokenNumber}` : "Booked appointment"}
          description={
            patient ? (
              <Link
                to="/$orgSlug/patients/$patientId"
                params={{ orgSlug, patientId: patient.id }}
                className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
              >
                {`${patient.mrn} · ${patient.name}`}
              </Link>
            ) : (
              `${appointment.callerName ?? "Unnamed caller"} · ${appointment.callerPhone ?? "No phone"}`
            )
          }
          action={
            <div className="flex items-center gap-2">
              <StaleDataNotice dataUpdatedAt={detail.dataUpdatedAt} />
              {hasToken && patient ? (
                <Button onClick={() => window.print()}>
                  <PrinterIcon data-icon="inline-start" />
                  Print slip
                </Button>
              ) : null}
            </div>
          }
        />

        <PageBody className="max-w-5xl">
          <section className="grid gap-px bg-border ring-1 ring-border sm:grid-cols-4">
            <DetailCell label="Token">
              {hasToken ? (
                // text-2xl deviates from the type scale: the token is what desk
                // staff and patients match at a glance, so it reads as a headline.
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {appointment.tokenNumber}
                </span>
              ) : (
                <span className="text-muted-foreground">Assigned at check-in</span>
              )}
            </DetailCell>
            <DetailCell label="Status">
              <OpdAppointmentStatusBadge status={appointment.status} />
            </DetailCell>
            {appointment.arrivedAt ? (
              <DetailCell label="Arrived">
                {formatDateTime(appointment.arrivedAt, timeZone)}
              </DetailCell>
            ) : appointment.scheduledFor ? (
              <DetailCell label="Scheduled">
                {formatDateTime(appointment.scheduledFor, timeZone)}
              </DetailCell>
            ) : (
              <DetailCell label="Created">
                {formatDateTime(appointment.createdAt, timeZone)}
              </DetailCell>
            )}
            <DetailCell label="Actions">
              <div className="flex flex-wrap gap-1">
                {appointment.status === "booked" ? (
                  <>
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
                  </>
                ) : appointment.status === "waiting" ? (
                  <>
                    <Button
                      size="xs"
                      disabled={changingStatus}
                      onClick={() => startConsultation.mutate({ orgSlug, appointmentId })}
                    >
                      Start consult
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={changingStatus}
                      onClick={() => setLeftUnseenOpen(true)}
                    >
                      Left unseen
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={changingStatus}
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : appointment.status === "in_consult" ? (
                  <Button
                    size="xs"
                    disabled={changingStatus}
                    onClick={() => complete.mutate({ orgSlug, appointmentId })}
                  >
                    Complete
                  </Button>
                ) : (
                  <span className="text-muted-foreground">No actions available</span>
                )}
              </div>
            </DetailCell>
          </section>

          <section className="grid gap-px bg-border ring-1 ring-border sm:grid-cols-2">
            {patient ? (
              <DetailCell label="Patient">
                <p className="font-medium">{patient.name}</p>
                <p className="text-muted-foreground">
                  {patient.mrn} · {patient.phone}
                </p>
                <p className="capitalize text-muted-foreground">
                  {age} · {patient.sex}
                </p>
              </DetailCell>
            ) : (
              <DetailCell label="Caller">
                <p className="font-medium">{appointment.callerName ?? "Unnamed caller"}</p>
                <p className="text-muted-foreground">{appointment.callerPhone ?? "No phone"}</p>
                <p className="text-muted-foreground">The patient record is linked at check-in.</p>
              </DetailCell>
            )}
            <DetailCell label="Care team">
              <p className="font-medium">{practitioner.name}</p>
              <p className="text-muted-foreground">{department.name}</p>
            </DetailCell>
          </section>

          <PrescriptionDocuments
            orgSlug={orgSlug}
            appointmentId={appointmentId}
            prescriptions={prescriptions}
            disabled={appointment.status === "cancelled"}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Charges</h2>
            <div className="overflow-x-auto ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-20 text-right">Qty</TableHead>
                    <TableHead className="w-36 text-right">Unit price</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No charges for this OPD appointment
                      </TableCell>
                    </TableRow>
                  ) : (
                    charges.map((charge) => (
                      <TableRow key={charge.id}>
                        <TableCell className="font-medium">{charge.description}</TableCell>
                        <TableCell className="text-right tabular-nums">{charge.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(charge.unitPrice, settings.data.currency)}
                        </TableCell>
                        <TableCell className="capitalize">{charge.status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
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
          <div className="border-b border-black py-5 text-center">
            <p className="uppercase tracking-[0.18em]">Outpatient token</p>
            <p className="mt-1 text-5xl font-bold tabular-nums">{appointment.tokenNumber}</p>
          </div>
          <dl className="grid grid-cols-[28mm_1fr] gap-x-3 gap-y-2 border-b border-black py-4">
            <dt className="font-semibold">OPD appointment</dt>
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

      {cancelOpen ? (
        <CancelOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={appointmentId}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
      {leftUnseenOpen ? (
        <MarkLeftUnseenOpdAppointmentDialog
          orgSlug={orgSlug}
          appointmentId={appointmentId}
          onClose={() => setLeftUnseenOpen(false)}
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
    <section className="ring-1 ring-border">
      <div className="flex items-start justify-between gap-3 border-b p-3">
        <div>
          <h2 className="text-sm font-medium">Paper prescription</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep the doctor's signed image or PDF as the source record.
          </p>
        </div>
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
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <FileTextIcon className="size-4" />
          No prescription scan attached.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="w-24">Size</TableHead>
                <TableHead className="w-44">Captured</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
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
        </div>
      )}
    </section>
  );
}

function DetailCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-h-16 bg-background p-3 text-xs">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
