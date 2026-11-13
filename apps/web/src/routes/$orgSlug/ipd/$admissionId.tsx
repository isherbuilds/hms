import { practitionerDisplayName } from "@hms/api/lib/labels";
import { authorize } from "@hms/auth/access";
import { Button } from "@hms/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { appHead } from "@/config/site";
import { AdmissionBill, admissionBillQuery, issuedInvoiceQuery } from "@/components/ipd-bill";
import {
  AdmissionStatusBadge,
  CancelAdmissionDialog,
  DischargeDialog,
  ReadyDialog,
  TransferDialog,
  UndoReadyDialog,
} from "@/components/ipd-dialogs";
import {
  AdmissionMedicines,
  admissionIssuesQuery,
  IssueMedicinesDialog,
} from "@/components/ipd-medicines";
import { DataList, ErrorNote, PageBody, PageHeader, Panel } from "@/components/page";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { IpdTabs } from "./route";

const admissionQuery = (orgSlug: string, admissionId: string) =>
  orpc.ipd.get.queryOptions({ input: { orgSlug, admissionId } });

export const Route = createFileRoute("/$orgSlug/ipd/$admissionId")({
  head: () => appHead("Admission"),
  // `?issue=1` opens the medicine issue form, so the pharmacy can link straight to it.
  validateSearch: z.object({ issue: z.literal(1).optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params: { orgSlug, admissionId } }) => {
    const { roles } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { ipd: ["read"] },
      "/$orgSlug/dashboard",
    );

    await Promise.all([
      queryClient.query(admissionQuery(orgSlug, admissionId)),
      authorize(roles, { pharmacy: ["read"] })
        ? queryClient.query(admissionIssuesQuery(orgSlug, admissionId))
        : null,
      // A billed stay shows its Invoice's payments, so that loads with the bill.
      authorize(roles, { billing: ["read"] })
        ? queryClient
            .query(admissionBillQuery(orgSlug, admissionId))
            .then((bill) =>
              bill.invoiceId === null
                ? null
                : queryClient.query(issuedInvoiceQuery(orgSlug, bill.invoiceId)),
            )
        : null,
    ]).catch(() => {});
  },
  component: AdmissionRoute,
});

type DialogKind = "transfer" | "ready" | "discharge" | "undo" | "cancel";

// A dialog acts on the Admission as it was when it opened, never a newer refresh.
type OpenDialog = { kind: DialogKind; admission: { id: string; revision: number } };

function AdmissionRoute() {
  const { orgSlug, admissionId } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const canUpdate = useCan(orgSlug, { ipd: ["update"] });
  const canCorrect = useCan(orgSlug, { ipd: ["correct"] });
  const canIssue = useCan(orgSlug, { pharmacy: ["issueAdmission"] });
  const canReadIssues = useCan(orgSlug, { pharmacy: ["read"] });
  const canReadBill = useCan(orgSlug, { billing: ["read"] });
  const canWriteBill = useCan(orgSlug, { billing: ["write"] });
  const [opened, setOpened] = useState<OpenDialog | null>(null);
  const issuing = Route.useSearch().issue === 1;
  const navigate = Route.useNavigate();
  const detail = useQuery(admissionQuery(orgSlug, admissionId));

  const bill = useQuery({ ...admissionBillQuery(orgSlug, admissionId), enabled: canReadBill });

  if (!detail.data) {
    return (
      <>
        <PageHeader title="Admission" />
        <IpdTabs orgSlug={orgSlug} />
        <PageBody>
          {detail.isError ? (
            <ErrorNote title="Could not load this admission" error={detail.error} />
          ) : (
            <span role="status" className="sr-only">
              Loading admission…
            </span>
          )}
        </PageBody>
      </>
    );
  }

  const { admission, patient, practitionerName, stays } = detail.data;
  const current = stays.find((stay) => stay.endedAt === null);
  const active = admission.status === "admitted" || admission.status === "discharge_ready";

  const open = (kind: DialogKind) =>
    setOpened({ kind, admission: { id: admission.id, revision: admission.revision } });

  const close = () => setOpened(null);
  // A dialog belongs to the Admission it opened on: one left open while the page moved
  // to another Admission is dropped rather than submitted against the old one.
  const mine = opened?.admission.id === admission.id ? opened : null;
  // Another screen changed the Admission: the open form no longer describes it.
  const stale = mine !== null && mine.admission.revision !== admission.revision;
  const dialog = stale ? null : mine?.kind;
  const ref = mine?.admission;

  const setIssuing = (open: boolean) =>
    void navigate({ search: open ? { issue: 1 } : {}, replace: true });

  // Medicines go only onto an unbilled stay; the server refuses a billed one either way.
  const billed = bill.data !== undefined && bill.data.invoiceId !== null;

  const issuable = canIssue && canReadIssues && active && !billed;

  return (
    <>
      <PageHeader
        title="Admission"
        action={
          active && canUpdate ? (
            <>
              <Button variant="outline" onClick={() => open("transfer")}>
                Move bed
              </Button>
              {admission.status === "admitted" ? (
                <Button onClick={() => open("ready")}>Ready to leave</Button>
              ) : (
                <Button onClick={() => open("discharge")}>Record departure</Button>
              )}
              {admission.status === "discharge_ready" || canCorrect ? (
                <ClientOnly fallback={null}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon" />}
                      aria-label="More actions"
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      {admission.status === "discharge_ready" ? (
                        <DropdownMenuItem onClick={() => open("undo")}>
                          Not leaving yet
                        </DropdownMenuItem>
                      ) : null}
                      {canCorrect ? (
                        <DropdownMenuItem variant="destructive" onClick={() => open("cancel")}>
                          Cancel admission
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ClientOnly>
              ) : null}
            </>
          ) : undefined
        }
      />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody width="max-w-4xl">
        {stale ? (
          <p role="status" className="text-muted-foreground">
            This admission changed on another screen, so the form was closed.
          </p>
        ) : null}
        <Panel padded minHeight="">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Patient">
              <Link
                to="/$orgSlug/patients/$patientId"
                params={{ orgSlug, patientId: patient.id }}
                className="capitalize underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
              >
                {patient.name}
              </Link>{" "}
              <span className="font-mono text-muted-foreground">{patient.mrn}</span>
            </Fact>
            <Fact label="Status">
              <AdmissionStatusBadge status={admission.status} />
            </Fact>
            <Fact label="Bed">
              {current ? (
                <>
                  {current.wardName} <span className="font-mono">{current.bedLabel}</span>
                </>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Doctor">
              <span className="capitalize">{practitionerDisplayName(practitionerName)}</span>
            </Fact>
            <Fact label="Admitted">{formatDateTime(admission.admittedAt, timeZone)}</Fact>
            {admission.readyAt ? (
              <Fact label="Ready to leave">{formatDateTime(admission.readyAt, timeZone)}</Fact>
            ) : null}
            {admission.dischargedAt ? (
              <Fact label="Left">{formatDateTime(admission.dischargedAt, timeZone)}</Fact>
            ) : null}
            {admission.cancelledAt ? (
              <Fact label="Cancelled">
                {formatDateTime(admission.cancelledAt, timeZone)} · {admission.cancelReason}
              </Fact>
            ) : null}
          </dl>
        </Panel>

        <Panel label="Beds" minHeight="">
          <DataList
            columns={[
              {
                head: "Bed",
                cell: (stay) => (
                  <span className="whitespace-nowrap">
                    {stay.wardName} <span className="font-mono">{stay.bedLabel}</span>
                  </span>
                ),
                mobile: "title",
              },
              {
                head: "From",
                cell: (stay) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {formatDateTime(stay.startedAt, timeZone)}
                  </span>
                ),
              },
              {
                head: "To",
                cell: (stay) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {stay.endedAt ? formatDateTime(stay.endedAt, timeZone) : "Now"}
                  </span>
                ),
              },
              {
                head: "Daily rate",
                cell: (stay) => (
                  <span className="tabular-nums">{formatMoney(stay.dailyPrice, currency)}</span>
                ),
                className: "text-right",
              },
            ]}
            rows={stays}
            rowKey={(stay) => stay.id}
          />
        </Panel>

        {canReadIssues ? (
          <AdmissionMedicines
            orgSlug={orgSlug}
            admissionId={admission.id}
            action={
              issuable ? (
                <Button size="xs" variant="outline" onClick={() => setIssuing(true)}>
                  Issue medicines
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {canReadBill ? (
          <AdmissionBill
            orgSlug={orgSlug}
            admission={admission}
            bill={bill}
            canWrite={canWriteBill}
            currency={currency}
          />
        ) : null}
      </PageBody>

      {issuing && issuable ? (
        <IssueMedicinesDialog
          orgSlug={orgSlug}
          admission={admission}
          onClose={() => setIssuing(false)}
        />
      ) : null}

      {ref && dialog === "transfer" ? (
        <TransferDialog
          orgSlug={orgSlug}
          admission={ref}
          currentBedId={current?.bedId ?? null}
          onClose={close}
        />
      ) : null}
      {ref && dialog === "ready" ? (
        <ReadyDialog orgSlug={orgSlug} admission={ref} onClose={close} />
      ) : null}
      {ref && dialog === "discharge" ? (
        <DischargeDialog orgSlug={orgSlug} admission={ref} onClose={close} />
      ) : null}
      {ref && dialog === "undo" ? (
        <UndoReadyDialog orgSlug={orgSlug} admission={ref} onClose={close} />
      ) : null}
      {ref && dialog === "cancel" ? (
        <CancelAdmissionDialog orgSlug={orgSlug} admission={ref} onClose={close} />
      ) : null}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
