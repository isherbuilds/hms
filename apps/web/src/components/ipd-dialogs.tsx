import { DECIMAL_PATTERN, parseDecimal } from "@hms/api/core/money";
import { localDateTime } from "@hms/api/lib/business-date";
import { practitionerDisplayName } from "@hms/api/lib/labels";
import { Badge } from "@hms/ui/components/badge";
import { Checkbox } from "@hms/ui/components/checkbox";
import { FormControl, FormField, FormItem, FormLabel } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  useFormContext,
  useWatch,
  type ControllerRenderProps,
  type FieldValues,
} from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { ErrorNote } from "@/components/page";
import { useCan } from "@/lib/membership";
import { formatDateTime, localInputValue, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

type AdmissionStatus = "admitted" | "discharge_ready" | "discharged" | "cancelled";

const STATUS_LABELS: Record<AdmissionStatus, string> = {
  admitted: "Admitted",
  discharge_ready: "Ready to leave",
  discharged: "Discharged",
  cancelled: "Cancelled",
};

export function AdmissionStatusBadge({ status }: { status: AdmissionStatus }) {
  const variant =
    status === "discharge_ready" ? "pending" : status === "admitted" ? "secondary" : "muted";

  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export type BedStatus = "available" | "occupied" | "blocked";

const BED_LABELS: Record<BedStatus, string> = {
  available: "Free",
  occupied: "Occupied",
  blocked: "Blocked",
};

export function BedStatusBadge({ status }: { status: BedStatus }) {
  const variant = status === "available" ? "outline" : status === "blocked" ? "muted" : "secondary";

  return <Badge variant={variant}>{BED_LABELS[status]}</Badge>;
}

// Blank means "now". Only administrators see these fields: an earlier time is a
// correction the server audits with its reason.
const earlierTime = {
  earlierAt: z.string(),
  reason: z.string().trim().max(500),
};

// The server refuses an earlier time without one, so the form asks first.
function requireEarlierReason(
  value: { earlierAt: string; reason: string },
  context: z.RefinementCtx,
) {
  if (value.earlierAt && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Give a reason for the earlier time",
    });
  }
}

function earlierFields(
  value: { earlierAt: string; reason: string },
  timeZone: string,
): { at?: Date; reason?: string } {
  return {
    at: value.earlierAt ? localDateTime(value.earlierAt, timeZone) : undefined,
    reason: value.reason || undefined,
  };
}

function EarlierTimeFields({ orgSlug, label }: { orgSlug: string; label: string }) {
  const canCorrect = useCan(orgSlug, { ipd: ["correct"] });
  const { timeZone } = useOrgDateTime();
  const earlierAt = useWatch<{ earlierAt: string }, "earlierAt">({ name: "earlierAt" });

  if (!canCorrect) return null;

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-muted-foreground">Only if it happened earlier</legend>
      <TextField
        name="earlierAt"
        label={label}
        type="datetime-local"
        className="tabular-nums"
        max={localInputValue(new Date(), timeZone)}
        description="Leave blank to record it now."
      />
      <TextField name="reason" label="Reason for the earlier time" required={earlierAt !== ""} />
    </fieldset>
  );
}

// A walk-in onto a held bed is refused; `ipd:correct` may override it with a reason,
// which turns the bed's holds into reservations that need a bed again.
const displaceFields = {
  displace: z.boolean(),
  displaceReason: z.string().trim().max(500),
};

function requireDisplaceReason(
  value: { displace: boolean; displaceReason: string },
  context: z.RefinementCtx,
) {
  if (value.displace && !value.displaceReason) {
    context.addIssue({
      code: "custom",
      path: ["displaceReason"],
      message: "Give a reason to release the hold",
    });
  }
}

type Refusal = { message: string; bedId: string };

/** Keeps the dialog open on the first hold refusal for a bed so it can be shown and, if
 * allowed, overridden. The server's `bed_held` decides, not the board snapshot. */
function useHoldRefusal(onClose: () => void) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const showsInline = (error: Error, bedId: string, displacing: boolean) =>
    hasErrorCode(error, "CONFLICT") &&
    errorReason(error) === "bed_held" &&
    !displacing &&
    refusal?.bedId !== bedId;

  const onError = (error: Error, bedId: string, displacing: boolean) => {
    if (!hasErrorCode(error, "CONFLICT")) return;

    if (showsInline(error, bedId, displacing)) setRefusal({ message: errorMessage(error), bedId });
    else onClose();
  };

  /** The refusal, only while the form is still on the bed it was about. */
  const refusalFor = (bedId: string) => (refusal?.bedId === bedId ? refusal.message : null);

  return { refusalFor, onError, showsInline };
}

type BoardHold = { patientName: string; plannedArrivalAt: Date };

function HoldRefusal({
  orgSlug,
  refusal,
  action,
  holds,
}: {
  orgSlug: string;
  refusal: string | null;
  action: string;
  /** The refused bed's holds, so the desk sees whose arrival the bed is kept for. */
  holds: readonly BoardHold[];
}) {
  const { timeZone } = useOrgDateTime();
  const canCorrect = useCan(orgSlug, { ipd: ["correct"] });
  const displace = useWatch<{ displace: boolean }, "displace">({ name: "displace" });

  if (refusal === null) return null;

  const [first, ...others] = holds;

  const heldFor = first
    ? `Held for ${first.patientName} from ${formatDateTime(first.plannedArrivalAt, timeZone)}${
        others.length > 0 ? `, and ${others.length} more` : ""
      }.`
    : undefined;

  return (
    <>
      <ErrorNote
        title={refusal}
        detail={[heldFor, canCorrect ? undefined : "Choose another bed, or ask an administrator."]
          .filter(Boolean)
          .join(" ")}
      />
      {canCorrect ? (
        <>
          <FormField
            name="displace"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel>
                  {action} anyway and release every reservation held on this bed
                </FormLabel>
              </FormItem>
            )}
          />
          {displace ? (
            <TextField name="displaceReason" label="Reason to release the hold" autoFocus />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function displaceInput(value: { displace: boolean; displaceReason: string }) {
  return value.displace ? { reason: value.displaceReason } : undefined;
}

const admitSchema = z
  .object({
    patient: z
      .custom<SelectedPatient | null>()
      .refine((patient): patient is SelectedPatient => patient !== null, "Choose the Patient"),
    practitionerId: z.string().min(1, "Choose the admitting doctor"),
    ...earlierTime,
    ...displaceFields,
  })
  .superRefine(requireEarlierReason)
  .superRefine(requireDisplaceReason);

export function AdmitDialog({
  orgSlug,
  bed,
  reservation,
  onClose,
}: {
  orgSlug: string;
  /** `holds` are the bed's live holds, apart from the one this admission converts. */
  bed: { id: string; label: string; wardName: string; holds: readonly BoardHold[] };
  /** The hold being turned into this admission, captured when the dialog opened. */
  reservation?: { id: string; revision: number; patient: SelectedPatient };
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const hold = useHoldRefusal(onClose);

  return (
    <FormDialog
      title={`Admit to ${bed.wardName} ${bed.label}`}
      description={
        reservation ? (
          <>
            <span className="capitalize">{reservation.patient.name}</span> (
            <span className="font-mono">{reservation.patient.mrn}</span>) arrives on their
            reservation. The bed shows as occupied from the time of admission.
          </>
        ) : (
          "The bed shows as occupied from the time of admission."
        )
      }
      submitLabel="Admit"
      schema={admitSchema}
      defaultValues={{
        patient: reservation?.patient ?? null,
        practitionerId: "",
        earlierAt: "",
        reason: "",
        displace: false,
        displaceReason: "",
      }}
      success="Patient admitted"
      onClose={onClose}
      onError={(error, value) => hold.onError(error, bed.id, value.displace)}
      showsInline={(error, value) => hold.showsInline(error, bed.id, value.displace)}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.admit.call({
          orgSlug,
          bedId: bed.id,
          patientId: value.patient.id,
          practitionerId: value.practitionerId,
          admittedAt: earlier.at,
          reason: earlier.reason,
          reservationId: reservation?.id,
          expectedReservationRevision: reservation?.revision,
          displace: displaceInput(value),
        });
      }}
    >
      {reservation ? null : (
        <ControlledField
          name="patient"
          label="Patient"
          render={(field) => (
            <OpdPatientSearch orgSlug={orgSlug} selected={field.value} onChange={field.onChange} />
          )}
        />
      )}
      <ControlledField
        name="practitionerId"
        label="Admitting doctor"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={practitioners.isPending}>
              <option value="">Choose a doctor</option>
              {(practitioners.data ?? []).map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner.name)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <EarlierTimeFields orgSlug={orgSlug} label="Admitted at" />
      <HoldRefusal
        orgSlug={orgSlug}
        refusal={hold.refusalFor(bed.id)}
        action="Admit"
        holds={bed.holds}
      />
    </FormDialog>
  );
}

type AdmissionRef = { id: string; revision: number };

const transferSchema = z
  .object({ bedId: z.string().min(1, "Choose the new bed"), ...earlierTime, ...displaceFields })
  .superRefine(requireEarlierReason)
  .superRefine(requireDisplaceReason);

// The refusal belongs to the bed chosen in the form, so it and its holds are read from there.
function MoveRefusal({
  orgSlug,
  refusalFor,
  beds,
}: {
  orgSlug: string;
  refusalFor: (bedId: string) => string | null;
  beds: ReadonlyArray<{ id: string; holds: readonly BoardHold[] }>;
}) {
  const bedId = useWatch<{ bedId: string }, "bedId">({ name: "bedId" });

  return (
    <HoldRefusal
      orgSlug={orgSlug}
      refusal={refusalFor(bedId)}
      action="Move"
      holds={beds.find((bed) => bed.id === bedId)?.holds ?? []}
    />
  );
}

// A new bed has not been refused yet, so an override ticked for the last one is cleared.
function MoveBedSelect({
  beds,
  held,
  disabled,
  field,
}: {
  beds: ReadonlyArray<{ id: string; wardName: string; label: string; categoryName: string }>;
  held: ReadonlySet<string>;
  disabled: boolean;
  field: ControllerRenderProps<FieldValues, string>;
}) {
  const { setValue } = useFormContext<{ displace: boolean; displaceReason: string }>();

  return (
    <FormControl>
      <NativeSelect
        {...field}
        disabled={disabled}
        onChange={(event) => {
          field.onChange(event);
          setValue("displace", false);
          setValue("displaceReason", "");
        }}
      >
        <option value="">Choose a free bed</option>
        {beds.map((bed) => (
          <option key={bed.id} value={bed.id}>
            {bed.wardName} {bed.label} · {bed.categoryName}
            {held.has(bed.id) ? " · held" : ""}
          </option>
        ))}
      </NativeSelect>
    </FormControl>
  );
}

export function TransferDialog({
  orgSlug,
  admission,
  currentBedId,
  onClose,
}: {
  orgSlug: string;
  admission: AdmissionRef;
  currentBedId: string | null;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const board = useQuery(orpc.ipd.bedBoard.queryOptions({ input: { orgSlug } }));
  const hold = useHoldRefusal(onClose);

  const free = (board.data?.beds ?? []).filter(
    (bed) => bed.status === "available" && bed.id !== currentBedId,
  );

  const held = new Set(free.filter((bed) => bed.holds.length > 0).map((bed) => bed.id));

  return (
    <FormDialog
      title="Move to another bed"
      description="The current bed is freed at the moment of the move."
      submitLabel="Move"
      schema={transferSchema}
      defaultValues={{ bedId: "", earlierAt: "", reason: "", displace: false, displaceReason: "" }}
      success="Patient moved"
      onClose={onClose}
      onError={(error, value) => hold.onError(error, value.bedId, value.displace)}
      showsInline={(error, value) => hold.showsInline(error, value.bedId, value.displace)}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.transferBed.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          bedId: value.bedId,
          effectiveAt: earlier.at,
          reason: earlier.reason,
          displace: displaceInput(value),
        });
      }}
    >
      <ControlledField
        name="bedId"
        label="New bed"
        description={board.isSuccess && free.length === 0 ? "No bed is free right now." : undefined}
        render={(field) => (
          <MoveBedSelect beds={free} held={held} disabled={board.isPending} field={field} />
        )}
      />
      <EarlierTimeFields orgSlug={orgSlug} label="Moved at" />
      <MoveRefusal orgSlug={orgSlug} refusalFor={hold.refusalFor} beds={free} />
    </FormDialog>
  );
}

const timedSchema = z.object(earlierTime).superRefine(requireEarlierReason);

export function ReadyDialog({
  orgSlug,
  admission,
  onClose,
}: {
  orgSlug: string;
  admission: AdmissionRef;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();

  return (
    <FormDialog
      title="Ready to leave"
      description="Record the signed discharge handoff. The Patient keeps the bed until they leave."
      submitLabel="Mark ready"
      schema={timedSchema}
      defaultValues={{ earlierAt: "", reason: "" }}
      success="Marked ready to leave"
      onClose={onClose}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.markDischargeReady.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          effectiveAt: earlier.at,
          reason: earlier.reason,
        });
      }}
    >
      <EarlierTimeFields orgSlug={orgSlug} label="Ready at" />
    </FormDialog>
  );
}

export function DischargeDialog({
  orgSlug,
  admission,
  onClose,
}: {
  orgSlug: string;
  admission: AdmissionRef;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();

  return (
    <FormDialog
      title="Record departure"
      description="The bed is blocked for cleaning. Billing and payment can follow later."
      submitLabel="Record departure"
      schema={timedSchema}
      defaultValues={{ earlierAt: "", reason: "" }}
      success="Departure recorded"
      onClose={onClose}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.discharge.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          effectiveAt: earlier.at,
          reason: earlier.reason,
        });
      }}
    >
      <EarlierTimeFields orgSlug={orgSlug} label="Left at" />
    </FormDialog>
  );
}

export const reasonSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason").max(500, "Keep it under 500 characters"),
});

export function UndoReadyDialog({
  orgSlug,
  admission,
  onClose,
}: {
  orgSlug: string;
  admission: AdmissionRef;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Not leaving yet"
      description="The Patient returns to admitted."
      submitLabel="Keep admitted"
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      success="Patient kept admitted"
      onClose={onClose}
      run={({ reason }) =>
        orpc.ipd.undoDischargeReady.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          reason,
        })
      }
    >
      <TextField name="reason" label="Reason" autoFocus />
    </FormDialog>
  );
}

export function CancelAdmissionDialog({
  orgSlug,
  admission,
  onClose,
}: {
  orgSlug: string;
  admission: AdmissionRef;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Cancel this admission"
      description="Only for an admission made in error. The bed is freed at once. If the Patient received care, record their departure instead."
      submitLabel="Cancel admission"
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      success="Admission cancelled"
      onClose={onClose}
      run={({ reason }) =>
        orpc.ipd.cancel.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          reason,
        })
      }
    >
      <TextField name="reason" label="What went wrong" autoFocus />
    </FormDialog>
  );
}

export function BlockBedDialog({
  orgSlug,
  bed,
  onClose,
}: {
  orgSlug: string;
  bed: { id: string; label: string; holds: readonly unknown[] };
  onClose: () => void;
}) {
  const { length } = bed.holds;
  // Only owner/admin authority releases holds; anyone else's block leaves them held.
  const canCorrect = useCan(orgSlug, { ipd: ["correct"] });
  const held = `${length} ${length === 1 ? "reservation" : "reservations"} held on it`;

  return (
    <FormDialog
      title={`Block bed ${bed.label}`}
      description={`A blocked bed takes no admissions until it is released.${
        length === 0
          ? ""
          : canCorrect
            ? ` The ${held} will need a bed again.`
            : ` The ${held} stay held and will need attention.`
      }`}
      submitLabel="Block bed"
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      success="Bed blocked"
      onClose={onClose}
      run={({ reason }) => orpc.ipd.blockBed.call({ orgSlug, bedId: bed.id, reason })}
    >
      <TextField name="reason" label="Reason" autoFocus />
    </FormDialog>
  );
}

const nameSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200, "Keep the name under 200 characters"),
});

export function WardDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  return (
    <FormDialog
      title="New ward"
      description="A ward groups beds on the board."
      submitLabel="Create ward"
      schema={nameSchema}
      defaultValues={{ name: "" }}
      success="Ward created"
      onClose={onClose}
      run={({ name }) => orpc.ipd.createWard.call({ orgSlug, name })}
    >
      <TextField name="name" label="Name" autoFocus />
    </FormDialog>
  );
}

export function BedCategoryDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  return (
    <FormDialog
      title="New bed type"
      description="A bed type, such as General or Private room, carries the daily rate."
      submitLabel="Create bed type"
      schema={nameSchema}
      defaultValues={{ name: "" }}
      success="Bed type created"
      onClose={onClose}
      run={({ name }) => orpc.ipd.createBedCategory.call({ orgSlug, name })}
    >
      <TextField name="name" label="Name" autoFocus />
    </FormDialog>
  );
}

const tariffSchema = z.object({
  catalogItemId: z.string().min(1, "Choose the billed service"),
  dailyPrice: z
    .string()
    .regex(DECIMAL_PATTERN, "Amount like 1500 or 1500.00")
    .transform(parseDecimal),
  effectiveFrom: z.string().min(1, "Choose when the rate starts"),
});

export function TariffDialog({
  orgSlug,
  category,
  services,
  servicesFooter,
  onClose,
}: {
  orgSlug: string;
  category: { id: string; name: string };
  services: { id: string; name: string }[];
  /** Loads the next page of services, so every one can be chosen. */
  servicesFooter: ReactNode;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();

  return (
    <FormDialog
      title={`Daily rate for ${category.name}`}
      description="A new rate applies to beds taken from its start; current stays keep their rate."
      submitLabel="Save rate"
      schema={tariffSchema}
      defaultValues={{
        catalogItemId: "",
        dailyPrice: "",
        effectiveFrom: localInputValue(new Date(), timeZone),
      }}
      success="Daily rate saved"
      onClose={onClose}
      run={(value) =>
        orpc.ipd.setBedTariff.call({
          orgSlug,
          categoryId: category.id,
          catalogItemId: value.catalogItemId,
          dailyPrice: value.dailyPrice,
          effectiveFrom: localDateTime(value.effectiveFrom, timeZone),
        })
      }
    >
      <ControlledField
        name="catalogItemId"
        label="Billed as"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              <option value="">Choose a service</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      {servicesFooter}
      <TextField
        name="dailyPrice"
        label="Daily rate"
        inputMode="decimal"
        className="tabular-nums"
      />
      <TextField
        name="effectiveFrom"
        label="Starts"
        type="datetime-local"
        className="tabular-nums"
      />
    </FormDialog>
  );
}

const bedSchema = z.object({
  wardId: z.string().min(1, "Choose the ward"),
  categoryId: z.string().min(1, "Choose the bed type"),
  label: z.string().trim().min(1, "Enter the bed's label").max(200),
});

export function BedDialog({
  orgSlug,
  wards,
  categories,
  onClose,
}: {
  orgSlug: string;
  wards: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="New bed"
      description="The label is what staff call the bed, unique within its ward."
      submitLabel="Add bed"
      schema={bedSchema}
      defaultValues={{
        wardId: wards.length === 1 ? wards[0]!.id : "",
        categoryId: categories.length === 1 ? categories[0]!.id : "",
        label: "",
      }}
      success="Bed added"
      onClose={onClose}
      run={(value) => orpc.ipd.createBed.call({ orgSlug, ...value })}
    >
      <ControlledField
        name="wardId"
        label="Ward"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              <option value="">Choose a ward</option>
              {wards.map((ward) => (
                <option key={ward.id} value={ward.id}>
                  {ward.name}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <ControlledField
        name="categoryId"
        label="Bed type"
        render={(field) => (
          <FormControl>
            <NativeSelect {...field}>
              <option value="">Choose a bed type</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <TextField name="label" label="Label" placeholder="G-1" />
    </FormDialog>
  );
}
