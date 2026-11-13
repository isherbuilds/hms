import { DECIMAL_PATTERN, parseDecimal } from "@hms/api/core/money";
import { localDateTime } from "@hms/api/lib/business-date";
import { practitionerDisplayName } from "@hms/api/lib/labels";
import { Badge } from "@hms/ui/components/badge";
import { FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { useCan } from "@/lib/membership";
import { localInputValue, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

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
      <TextField name="reason" label="Reason for the earlier time" />
    </fieldset>
  );
}

const admitSchema = z.object({
  patient: z
    .custom<SelectedPatient | null>()
    .refine((patient): patient is SelectedPatient => patient !== null, "Choose the Patient"),
  practitionerId: z.string().min(1, "Choose the admitting doctor"),
  ...earlierTime,
});

export function AdmitDialog({
  orgSlug,
  bed,
  onClose,
}: {
  orgSlug: string;
  bed: { id: string; label: string; wardName: string };
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));

  return (
    <FormDialog
      title={`Admit to ${bed.wardName} ${bed.label}`}
      description="The bed shows as occupied from the time of admission."
      submitLabel="Admit"
      schema={admitSchema}
      defaultValues={{ patient: null, practitionerId: "", earlierAt: "", reason: "" }}
      success="Patient admitted"
      onClose={onClose}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.admit.call({
          orgSlug,
          bedId: bed.id,
          patientId: value.patient.id,
          practitionerId: value.practitionerId,
          admittedAt: earlier.at,
          reason: earlier.reason,
        });
      }}
    >
      <ControlledField
        name="patient"
        label="Patient"
        render={(field) => (
          <OpdPatientSearch orgSlug={orgSlug} selected={field.value} onChange={field.onChange} />
        )}
      />
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
    </FormDialog>
  );
}

type AdmissionRef = { id: string; revision: number };

const transferSchema = z.object({
  bedId: z.string().min(1, "Choose the new bed"),
  ...earlierTime,
});

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

  const free = (board.data?.beds ?? []).filter(
    (bed) => bed.status === "available" && bed.id !== currentBedId,
  );

  return (
    <FormDialog
      title="Move to another bed"
      description="The current bed is freed at the moment of the move."
      submitLabel="Move"
      schema={transferSchema}
      defaultValues={{ bedId: "", earlierAt: "", reason: "" }}
      success="Patient moved"
      onClose={onClose}
      run={(value) => {
        const earlier = earlierFields(value, timeZone);

        return orpc.ipd.transferBed.call({
          orgSlug,
          admissionId: admission.id,
          expectedRevision: admission.revision,
          bedId: value.bedId,
          effectiveAt: earlier.at,
          reason: earlier.reason,
        });
      }}
    >
      <ControlledField
        name="bedId"
        label="New bed"
        description={board.isSuccess && free.length === 0 ? "No bed is free right now." : undefined}
        render={(field) => (
          <FormControl>
            <NativeSelect {...field} disabled={board.isPending}>
              <option value="">Choose a free bed</option>
              {free.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.wardName} {bed.label} · {bed.categoryName}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        )}
      />
      <EarlierTimeFields orgSlug={orgSlug} label="Moved at" />
    </FormDialog>
  );
}

const timedSchema = z.object(earlierTime);

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

const reasonSchema = z.object({
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
  bed: { id: string; label: string };
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Block bed ${bed.label}`}
      description="A blocked bed takes no admissions until it is released."
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
  onClose,
}: {
  orgSlug: string;
  category: { id: string; name: string };
  services: { id: string; name: string }[];
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
