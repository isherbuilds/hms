import { guardianLabel } from "@hms/api/lib/schemas";
import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2Icon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { ErrorNote } from "@/components/page";
import { OpdTreatmentPanel } from "@/components/opd-treatment-panel";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { patientAgeLabel } from "@/lib/patient-age";

import { useOpdRecord } from "@/lib/opd-record";
import { practitionerDisplayName } from "@/lib/practitioner-name";

const SCAN_EXTENSION_TYPES = new Map([
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["gif", "image/gif"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["bmp", "image/bmp"],
]);

// Browsers report an empty `File.type` for some valid scans; uploading those
// unresolved would finalize an orphan file that attach then rejects.
function prescriptionMimeType(file: File): string | null {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) {
    return file.type;
  }

  if (file.type !== "") {
    return null;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  return SCAN_EXTENSION_TYPES.get(extension) ?? null;
}

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId/")({
  // The flags below belong to one appointment; the next must not inherit them.
  remountDeps: ({ params }) => ({ appointmentId: params.appointmentId }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // Caught here so a settings outage is reported inside the tab rather than replacing
    // the whole record with the route's error page.
    await queryClient.query(orpc.settings.get.queryOptions({ input: { orgSlug } })).catch(() => {});
  },
  component: OpdAppointmentDetailRoute,
});

function OpdAppointmentDetailRoute() {
  const { orgSlug, appointmentId } = Route.useParams();
  const { timeZone, today } = useOrgDateTime();
  const { record } = useOpdRecord();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // Cashiers and accountants read the record; attaching a scan needs `opd:update`.
  const canEdit = useCan(orgSlug, { opd: ["update"] });

  // Only the printed slip needs settings, so a settings outage never holds up the tab.
  const settings = useQuery({
    ...orpc.settings.get.queryOptions({ input: { orgSlug } }),
    select: (data) => ({ legalName: data.legalName, address: data.address }),
  });

  const { appointment, patient, practitioner, department, charges, prescriptions } = record;
  const guardian = patient && guardianLabel(patient);

  const consultCharge = charges.find(
    (charge) => charge.revenueCategory === "consultation" && charge.status !== "voided",
  );

  const age = patient
    ? `${patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)} years`
    : null;

  // A booked appointment has no token or patient yet — both arrive at check-in.
  const hasToken = appointment.tokenNumber != null;

  return (
    <>
      <OpdTreatmentPanel orgSlug={orgSlug} appointmentId={appointmentId} />

      <PrescriptionDocuments
        orgSlug={orgSlug}
        appointmentId={appointmentId}
        prescriptions={prescriptions}
        canEdit={canEdit && appointment.status !== "cancelled"}
      />

      {hasToken && patient && settings.error ? (
        <ErrorNote title="Could not load organisation settings" error={settings.error} />
      ) : null}

      {hasToken && patient && settings.data ? (
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
              <span className="capitalize">{patient.name}</span>
              {guardian ? (
                <span>
                  {" "}
                  {guardian.relation} <span className="capitalize">{guardian.name}</span>
                </span>
              ) : null}
              {` · ${patient.mrn} · ${age} · ${patient.sex}`}
            </dd>
            <dt className="font-semibold">Practitioner</dt>
            <dd className="capitalize">{practitionerDisplayName(practitioner.name)}</dd>
            <dt className="font-semibold">Department</dt>
            <dd>{department.name}</dd>
          </dl>
          {consultCharge ? (
            <div className="flex items-center justify-between gap-4 py-4">
              <span>{consultCharge.description}</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(consultCharge.unitPrice, currency)}
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
    </>
  );
}

function PrescriptionDocuments({
  orgSlug,
  appointmentId,
  prescriptions,
  canEdit,
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
  canEdit: boolean;
}) {
  const { timeZone } = useOrgDateTime();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async ({ file, mimeType }: { file: File; mimeType: string }) => {
      const fileId = await uploadOrgFile(orgSlug, file, mimeType);
      await orpc.opd.attachPrescription.call({ orgSlug, appointmentId, fileId });
    },
    onSuccess: () => {
      toast.success("Prescription scan attached");
    },
  });

  const attach = (file: File) => {
    const mimeType = prescriptionMimeType(file);

    if (!mimeType) {
      toast.error("Only image or PDF scans can be attached");

      return;
    }

    upload.mutate({ file, mimeType });
  };

  const open = async (fileId: string) => {
    try {
      await openOrgFile(orgSlug, fileId);
    } catch (error) {
      toast.error(errorMessage(error, "Could not open prescription scan"));
    }
  };

  const remove = useMutation({
    mutationFn: (attachmentId: string) =>
      orpc.opd.detachPrescription.call({ orgSlug, attachmentId }),
    onSuccess: () => {
      toast.success("Prescription scan removed; the private file was kept");
    },
  });

  return (
    // Printing this tab prints the token slip alone.
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-muted-foreground">Paper prescription</h2>
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) attach(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon data-icon="inline-start" />
              {upload.isPending ? "Uploading…" : "Attach scan"}
            </Button>
          </>
        ) : null}
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
                    {canEdit ? (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="destructive"
                        aria-label={`Remove ${prescription.name}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(prescription.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
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
