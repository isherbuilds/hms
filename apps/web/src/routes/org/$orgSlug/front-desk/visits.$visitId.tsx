import { Badge } from "@better-stack/ui/components/badge";
import { Button } from "@better-stack/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-stack/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@better-stack/ui/components/form";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { SubmitButton } from "@better-stack/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-stack/ui/components/table";
import { Textarea } from "@better-stack/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

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
  if (ageYears !== null) return `${ageYears} years`;
  if (!dateOfBirth) return "Age not recorded";

  const today = new Date();
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return `${age} years`;
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
}

function VisitDetailRoute() {
  const { orgSlug, visitId } = Route.useParams();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const detail = useQuery(orpc.visit.get.queryOptions({ input: { orgSlug, visitId } }));
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
      onError: (error) => toast.error(error.message),
    }),
  );

  if (detail.isPending || settings.isPending) {
    return (
      <>
        <PageHeader title="Visit" description="Outpatient visit" />
        <div className="flex max-w-4xl flex-col gap-3 p-4" aria-busy>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }

  if (detail.isError || settings.isError) {
    const error = detail.error ?? settings.error;
    return (
      <>
        <PageHeader title="Visit" description="Outpatient visit" />
        <div role="alert" className="m-4 border-l-2 border-destructive pl-3 text-xs">
          <p className="font-medium">Could not load visit</p>
          <p className="mt-0.5 text-muted-foreground">{error?.message}</p>
        </div>
      </>
    );
  }

  const { visit, patient, practitioner, department, charges } = detail.data;
  const consultCharge = charges.find((charge) => charge.sourceType === "consult_fee");
  const age = patientAge(patient.dateOfBirth, patient.ageYears);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Token ${visit.tokenNumber}`}
          description={`${patient.mrn} · ${patient.name}`}
          action={
            <Button onClick={() => window.print()}>
              <PrinterIcon data-icon="inline-start" />
              Print slip
            </Button>
          }
        />

        <div className="flex max-w-5xl flex-col gap-4 p-4">
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
        </div>
      </div>

      <article
        data-visit-slip
        className="hidden bg-white p-6 text-[11px] leading-tight text-black print:block print:p-0"
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

function DetailCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-h-16 bg-background p-3 text-xs">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
      onError: (error) => toast.error(error.message),
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
