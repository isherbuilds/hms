import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Skeleton } from "@hms/ui/components/skeleton";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileTextIcon, PrinterIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { LastUpdated } from "@/components/last-updated";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { patientAgeYears } from "@/lib/patient-age";
import { refreshVisitOnConflict } from "@/lib/visit-operational-query";

const VISIT_STATUSES = ["waiting", "in_consult", "completed", "cancelled"] as const;
type VisitStatus = (typeof VISIT_STATUSES)[number];

const STATUS_LABELS: Record<VisitStatus, string> = {
  waiting: "Waiting",
  in_consult: "In consult",
  completed: "Completed",
  cancelled: "Cancelled",
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const cancelSchema = z.object({
  cancelReason: z.string().trim().min(1, "Enter a cancellation reason").max(500),
});

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
 * Resolves the MIME type `visit.attachPrescription` will accept, or null.
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

export const Route = createFileRoute("/org/$orgSlug/front-desk/visits/$visitId")({
  loader: ({ context: { queryClient }, params: { orgSlug, visitId } }) => {
    void Promise.all([
      queryClient.prefetchQuery(orpc.visit.get.queryOptions({ input: { orgSlug, visitId } })),
      queryClient.prefetchQuery(orpc.settings.get.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: VisitDetailRoute,
});

function patientAge(dateOfBirth: string | null, ageYears: number | null): string {
  const age = patientAgeYears(dateOfBirth, ageYears);
  return age === null ? "Age not recorded" : `${age} years`;
}

// Kept per currency: this runs once per charge line, and constructing an Intl
// formatter is not free.
const moneyFormatters = new Map<string, Intl.NumberFormat>();

function formatMoney(amount: string, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(amount));
}

function VisitDetailRoute() {
  const { orgSlug, visitId } = Route.useParams();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const detailQuery = {
    ...orpc.visit.get.queryOptions({ input: { orgSlug, visitId } }),
    ...OPERATIONAL_REFETCH,
  };
  const detail = useQuery(detailQuery);
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  const transition = useMutation(
    orpc.visit.transition.mutationOptions({
      onSuccess: (visit) => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.visit.get.key({ input: { orgSlug, visitId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.visit.queue.key({ input: { orgSlug } }),
          }),
        ]);
        toast.success(visit.status === "in_consult" ? "Consultation started" : "Visit completed");
      },
      onError: (error) => {
        if (refreshVisitOnConflict(queryClient, error, orgSlug, visitId)) {
          toast.error(
            "Another terminal already moved this visit — refreshed to the current state.",
          );
          return;
        }
        toast.error(error.message);
      },
    }),
  );

  if (detail.isPending || settings.isPending) {
    return (
      <>
        <PageHeader title="Visit" description="Outpatient visit" />
        <PageBody className="max-w-4xl" aria-busy>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </PageBody>
      </>
    );
  }

  if (detail.isError || settings.isError) {
    const error = detail.error ?? settings.error;
    return (
      <>
        <PageHeader title="Visit" description="Outpatient visit" />
        <ErrorNote title="Could not load visit" detail={error?.message} inset />
      </>
    );
  }

  const { visit, patient, practitioner, department, charges, prescriptions } = detail.data;
  const consultCharge = charges.find((charge) => charge.sourceType === "consult_fee");
  const age = patientAge(patient.dateOfBirth, patient.ageYears);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Token ${visit.tokenNumber}`}
          description={`${patient.mrn} · ${patient.name}`}
          action={
            <div className="flex items-center gap-2">
              <LastUpdated queryKeys={[detailQuery.queryKey]} />
              <Button onClick={() => window.print()}>
                <PrinterIcon data-icon="inline-start" />
                Print slip
              </Button>
            </div>
          }
        />

        <PageBody className="max-w-5xl">
          <section className="grid gap-px bg-border ring-1 ring-border sm:grid-cols-4">
            <DetailCell label="Token">
              <span className="text-2xl font-semibold tabular-nums">{visit.tokenNumber}</span>
            </DetailCell>
            <DetailCell label="Status">
              <VisitStatusBadge status={visit.status} />
            </DetailCell>
            <DetailCell label="Created">
              {dateTimeFormatter.format(new Date(visit.createdAt))}
            </DetailCell>
            <DetailCell label="Actions">
              <div className="flex flex-wrap gap-1">
                {visit.status === "waiting" ? (
                  <>
                    <Button
                      size="xs"
                      disabled={transition.isPending}
                      onClick={() => transition.mutate({ orgSlug, visitId, to: "in_consult" })}
                    >
                      Start consult
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={transition.isPending}
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : visit.status === "in_consult" ? (
                  <Button
                    size="xs"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ orgSlug, visitId, to: "completed" })}
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
            <DetailCell label="Patient">
              <p className="font-medium">{patient.name}</p>
              <p className="text-muted-foreground">
                {patient.mrn} · {patient.phone}
              </p>
              <p className="capitalize text-muted-foreground">
                {age} · {patient.sex}
              </p>
            </DetailCell>
            <DetailCell label="Care team">
              <p className="font-medium">{practitioner.name}</p>
              <p className="text-muted-foreground">{department.name}</p>
            </DetailCell>
          </section>

          <PrescriptionDocuments
            orgSlug={orgSlug}
            visitId={visitId}
            prescriptions={prescriptions}
            disabled={visit.status === "cancelled"}
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
                        No charges for this visit
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

      <article
        data-visit-slip
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
          <p className="mt-1 text-5xl font-bold tabular-nums">{visit.tokenNumber}</p>
        </div>
        <dl className="grid grid-cols-[28mm_1fr] gap-x-3 gap-y-2 border-b border-black py-4">
          <dt className="font-semibold">Visit</dt>
          <dd>{dateTimeFormatter.format(new Date(visit.createdAt))}</dd>
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

      <style>{`@media print {
        @page { size: A5 portrait; margin: 10mm; }
        body * { visibility: hidden !important; }
        [data-visit-slip], [data-visit-slip] * { visibility: visible !important; }
        [data-visit-slip] { position: fixed; inset: 0; width: 100%; }
      }`}</style>

      {cancelOpen ? (
        <CancelVisitDialog
          orgSlug={orgSlug}
          visitId={visitId}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </>
  );
}

function PrescriptionDocuments({
  orgSlug,
  visitId,
  prescriptions,
  disabled,
}: {
  orgSlug: string;
  visitId: string;
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
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.visit.get.key({ input: { orgSlug, visitId } }),
      }),
      // Uploads create a ready file and attach/detach write audit rows, so the
      // file-domain views must not keep serving their 60s-stale caches.
      queryClient.invalidateQueries({
        queryKey: orpc.files.list.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.summary.key({ input: { orgSlug } }),
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
      await orpc.visit.attachPrescription.call({ orgSlug, visitId, fileId });
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
      await orpc.visit.detachPrescription.call({ orgSlug, attachmentId });
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
                    {dateTimeFormatter.format(new Date(prescription.createdAt))}
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

function VisitStatusBadge({ status }: { status: string }) {
  const variant =
    status === "waiting"
      ? "secondary"
      : status === "in_consult"
        ? "default"
        : status === "cancelled"
          ? "destructive"
          : "muted";
  return <Badge variant={variant}>{STATUS_LABELS[status as VisitStatus] ?? status}</Badge>;
}

function CancelVisitDialog({
  orgSlug,
  visitId,
  onClose,
}: {
  orgSlug: string;
  visitId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(cancelSchema, { defaultValues: { cancelReason: "" } });
  const cancel = useMutation(
    orpc.visit.transition.mutationOptions({
      onSuccess: () => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.visit.get.key({ input: { orgSlug, visitId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.visit.queue.key({ input: { orgSlug } }),
          }),
        ]);
        toast.success("Visit cancelled");
        onClose();
      },
      onError: (error) => {
        if (refreshVisitOnConflict(queryClient, error, orgSlug, visitId)) {
          toast.error(
            "Another terminal already moved this visit — refreshed to the current state.",
          );
          return;
        }
        toast.error(error.message);
      },
    }),
  );
  const submit = form.handleSubmit(({ cancelReason }) => {
    cancel.mutate({ orgSlug, visitId, to: "cancelled", cancelReason });
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel visit</DialogTitle>
          <DialogDescription>
            The reason is recorded on the visit and its pending charges.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="cancelReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} autoFocus disabled={cancel.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={cancel.isPending} onClick={onClose}>
                Keep visit
              </Button>
              <SubmitButton isSubmitting={cancel.isPending}>Cancel visit</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
