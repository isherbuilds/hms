import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";
import { Combobox } from "@hms/ui/components/combobox";
import { Button } from "@hms/ui/components/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { ControlledField, TextField } from "@/components/form-fields";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { orpc } from "@/lib/orpc";
import { practitionerDisplayName } from "@/lib/practitioner-name";

export type TreatmentAction = "new" | "add" | "next";

type Procedure = { id: string; name: string; code: string; unitPrice: bigint };

const procedureField = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    unitPrice: z.bigint(),
  })
  .nullable()
  // A type guard, so a submitted item carries the picked service instead of `null`.
  .refine((value): value is Procedure => value !== null, "Choose a service");

const itemFields = {
  procedure: procedureField,
  qtyPlanned: z.coerce.number().int().min(1).max(999),
  unitPrice: z.string().regex(DECIMAL_PATTERN, "Amount like 150.00").transform(parseDecimal),
  note: z.string().trim().max(500),
};

const NEW_ITEM = { procedure: null, qtyPlanned: 1, unitPrice: "0.00", note: "" };

const newPlanSchema = z.object({
  practitionerId: z.string().min(1, "Choose a practitioner"),
  ...itemFields,
  nextSittingOn: z.string(),
  nextSittingNote: z.string().trim().max(500),
});

const addItemSchema = z.object(itemFields);

const nextSittingSchema = z.object({ date: z.string(), note: z.string().trim().max(500) });

const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const REASON_DIALOGS = {
  close: {
    title: "Close treatment plan",
    description: "Close an abandoned or stopped course without posting future work.",
    submitLabel: "Close plan",
    success: "Treatment plan closed",
  },
  drop: {
    title: "Drop treatment item",
    description: "Keep the quote history without billing work that will not be delivered.",
    submitLabel: "Drop item",
    success: "Treatment item dropped",
  },
};

/** The item a plan dialog sends, once the picked procedure is mapped onto its id. */
function itemInput({ procedure, note, ...rest }: z.output<typeof addItemSchema>) {
  return { catalogItemId: procedure.id, note: note || undefined, ...rest };
}

export function NewPlanDialog({
  orgSlug,
  patientId,
  appointmentId,
  practitionerId,
  onClose,
}: {
  orgSlug: string;
  patientId: string;
  /** The visit that becomes the plan's first sitting. */
  appointmentId: string;
  /** Preset from the visit; the form still lets the desk change it. */
  practitionerId: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="New treatment plan"
      description="Start with the first accepted item. Add more items at any time."
      submitLabel="Create plan"
      schema={newPlanSchema}
      defaultValues={{ practitionerId, ...NEW_ITEM, nextSittingOn: "", nextSittingNote: "" }}
      success="Treatment plan created"
      onClose={onClose}
      run={({ practitionerId, nextSittingOn, nextSittingNote, ...item }) =>
        orpc.treatment.create.call({
          orgSlug,
          patientId,
          appointmentId,
          practitionerId,
          nextSittingOn: nextSittingOn || undefined,
          nextSittingNote: nextSittingNote || undefined,
          item: itemInput(item),
        })
      }
    >
      <PractitionerField orgSlug={orgSlug} />
      <ItemFields orgSlug={orgSlug} />
      <TextField name="nextSittingOn" label="Next sitting" type="date" />
      <TextField name="nextSittingNote" label="Next sitting note" multiline />
    </FormDialog>
  );
}

export function AddItemDialog({
  orgSlug,
  planId,
  onClose,
}: {
  orgSlug: string;
  planId: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Add plan item"
      description="Add accepted work at its quoted price."
      submitLabel="Add item"
      schema={addItemSchema}
      defaultValues={NEW_ITEM}
      success="Plan item added"
      onClose={onClose}
      run={(item) => orpc.treatment.addItem.call({ orgSlug, planId, item: itemInput(item) })}
    >
      <ItemFields orgSlug={orgSlug} />
    </FormDialog>
  );
}

export function NextSittingDialog({
  orgSlug,
  plan,
  onClose,
}: {
  orgSlug: string;
  plan: { id: string; nextSittingOn: string | null; nextSittingNote: string | null };
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Next sitting"
      description="Set the date the desk should follow up."
      submitLabel="Save next sitting"
      schema={nextSittingSchema}
      defaultValues={{ date: plan.nextSittingOn ?? "", note: plan.nextSittingNote ?? "" }}
      success="Next sitting updated"
      onClose={onClose}
      run={(value) =>
        orpc.treatment.setNextSitting.call({
          orgSlug,
          planId: plan.id,
          nextSittingOn: value.date || null,
          note: value.note || null,
        })
      }
    >
      <TextField name="date" label="Date" type="date" />
      <TextField name="note" label="Note" multiline />
    </FormDialog>
  );
}

export type PostTarget = { itemId: string; description: string; remaining: number };

export function PostItemDialog({
  orgSlug,
  appointmentId,
  target,
  onClose,
}: {
  orgSlug: string;
  appointmentId: string;
  target: PostTarget;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Post to this visit"
      description={`${target.description}: ${target.remaining} left in the plan.`}
      submitLabel="Post to this visit"
      schema={z.object({ qty: z.coerce.number().int().min(1).max(target.remaining) })}
      defaultValues={{ qty: 1 }}
      success="Work posted to this visit"
      onClose={onClose}
      run={({ qty }) =>
        orpc.treatment.postToVisit.call({ orgSlug, appointmentId, itemId: target.itemId, qty })
      }
    >
      <TextField
        name="qty"
        label="Quantity delivered"
        type="number"
        min={1}
        max={target.remaining}
      />
    </FormDialog>
  );
}

export type ReasonTarget = { kind: "close"; planId: string } | { kind: "drop"; itemId: string };

/** Closing a plan and dropping an item differ only in copy and the call behind them. */
export function ReasonDialog({
  orgSlug,
  target,
  onClose,
}: {
  orgSlug: string;
  target: ReasonTarget;
  onClose: () => void;
}) {
  return (
    <FormDialog
      {...REASON_DIALOGS[target.kind]}
      schema={reasonSchema}
      defaultValues={{ reason: "" }}
      onClose={onClose}
      run={async ({ reason }) => {
        if (target.kind === "close") {
          await orpc.treatment.close.call({ orgSlug, planId: target.planId, reason });

          return;
        }

        await orpc.treatment.dropItem.call({ orgSlug, itemId: target.itemId, reason });
      }}
    >
      <TextField name="reason" label="Reason" multiline />
    </FormDialog>
  );
}

function PractitionerField({ orgSlug }: { orgSlug: string }) {
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));

  return (
    // Controlled, so the picked practitioner survives the options arriving.
    <ControlledField
      name="practitionerId"
      label="Practitioner"
      render={(field) => (
        <FormControl>
          <NativeSelect {...field} className="capitalize">
            <option value="">Choose a practitioner</option>
            {practitioners.data?.map((practitioner) => (
              <option key={practitioner.id} value={practitioner.id}>
                {practitionerDisplayName(practitioner.name)}
              </option>
            ))}
          </NativeSelect>
        </FormControl>
      )}
    />
  );
}

/** Search only while nothing is picked; a pick becomes a row with Change, like the intake patient. */
function ProcedureSearch({
  orgSlug,
  onSelect,
  inputRef,
  ...inputProps
}: {
  orgSlug: string;
  onSelect: (item: Procedure) => void;
  inputRef: (element: HTMLInputElement | null) => void;
} & Pick<
  ComponentPropsWithoutRef<"input">,
  "id" | "aria-describedby" | "aria-invalid" | "onBlur"
>) {
  const search = useCatalogSearch({
    orgSlug,
    includeConsultation: false,
    noMatch: "No procedure matches",
  });

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 z-10 size-3.5 text-muted-foreground" />
      <Combobox
        items={search.items}
        getItemKey={(item) => item.id}
        getItemLabel={(item) => item.name}
        onInputValueChange={search.onInputValueChange}
        onSelect={onSelect}
        open={search.open}
        onOpenChange={search.setOpen}
        inputRef={inputRef}
        inputClassName="pl-8"
        inputProps={{
          ...inputProps,
          name: "catalogItemId",
          autoComplete: "off",
          placeholder: "Search procedure code or name",
        }}
        itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
        renderItem={(item) => (
          <>
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="font-mono text-muted-foreground">{item.code}</span>
            </span>
            <span className="tabular-nums">{formatDecimal(item.unitPrice)}</span>
          </>
        )}
        emptyContent={
          search.emptyMessage ? (
            <p className="px-3 py-2 text-muted-foreground">{search.emptyMessage}</p>
          ) : undefined
        }
      />
    </div>
  );
}

function ItemFields({ orgSlug }: { orgSlug: string }) {
  const { control, setValue, setFocus } = useFormContext<{
    procedure: Procedure | null;
    qtyPlanned: number;
    unitPrice: string;
  }>();

  // The quote follows the picked service; the desk can still change the price after.
  // Picking unmounts the search input, so hand the caret to the next field rather than
  // letting it fall back to the dialog.
  const choose = (item: Procedure) => {
    setValue("procedure", item, { shouldDirty: true, shouldValidate: true });
    setValue("unitPrice", formatDecimal(item.unitPrice), { shouldDirty: true });
    setFocus("qtyPlanned");
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Not `ControlledField`: the picked row replaces the control instead of filling
          it, and the typed context keeps `field.value` a `Procedure`. */}
      <FormField
        control={control}
        name="procedure"
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Procedure</FormLabel>
            {field.value ? (
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{field.value.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {field.value.code} · {formatDecimal(field.value.unitPrice)}
                  </span>
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setValue("procedure", null, { shouldDirty: true })}
                >
                  Change
                </Button>
              </div>
            ) : (
              <FormControl>
                <ProcedureSearch
                  orgSlug={orgSlug}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  onSelect={choose}
                />
              </FormControl>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
      <TextField name="qtyPlanned" label="Planned quantity" type="number" min={1} />
      <TextField name="unitPrice" label="Quoted unit price" inputMode="decimal" />
      <TextField
        name="note"
        label="Note"
        placeholder="Tooth, site, or why the price differs"
        className="sm:col-span-2"
      />
    </div>
  );
}
