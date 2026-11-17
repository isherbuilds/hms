import { DECIMAL_PATTERN, formatDecimal, parseDecimal } from "@hms/api/core/money";
import { localDateTime } from "@hms/api/lib/business-date";
import { Button } from "@hms/ui/components/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useFieldArray, useFormContext, useFormState } from "react-hook-form";
import { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { localInputValue, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

// The server takes at most this many daily lines per bed type.
const MAX_LINES = 10;

const tariffSchema = z.object({
  lines: z
    .array(
      z.object({
        catalogItemId: z.string().min(1, "Choose the service"),
        dailyPrice: z
          .string()
          .regex(DECIMAL_PATTERN, "Amount like 1500 or 1500.00")
          .transform(parseDecimal),
      }),
    )
    .min(1, "Add the room's daily line")
    .max(MAX_LINES)
    .refine(
      (lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length,
      "List each service once",
    ),
  effectiveFrom: z.string().min(1, "Choose when the rate starts"),
});

type TariffInput = z.input<typeof tariffSchema>;

type Service = { id: string; name: string };

type CurrentLine = { catalogItemId: string; serviceName: string; dailyPrice: bigint };

const blankLine = () => ({ catalogItemId: "", dailyPrice: "" });

/** A bed type's daily lines: the room first, then nursing, duty doctor or the like. */
export function TariffDialog({
  orgSlug,
  category,
  services,
  servicesFooter,
  onClose,
}: {
  orgSlug: string;
  category: { id: string; name: string; currentTariff: { lines: CurrentLine[] } | null };
  services: Service[];
  /** Loads the next page of services, so every one can be chosen. */
  servicesFooter: ReactNode;
  onClose: () => void;
}) {
  const { timeZone } = useOrgDateTime();
  const current = category.currentTariff?.lines ?? [];

  // The lines in force stay choosable even before their page of services has loaded.
  const choices = [
    ...current
      .filter((line) => !services.some((service) => service.id === line.catalogItemId))
      .map((line) => ({ id: line.catalogItemId, name: line.serviceName })),
    ...services,
  ];

  return (
    <FormDialog
      title={`Daily rate for ${category.name}`}
      description="A new rate applies to beds taken from its start; current stays keep their rate."
      submitLabel="Save rate"
      schema={tariffSchema}
      defaultValues={{
        lines:
          current.length > 0
            ? current.map((line) => ({
                catalogItemId: line.catalogItemId,
                dailyPrice: formatDecimal(line.dailyPrice),
              }))
            : [blankLine()],
        effectiveFrom: localInputValue(new Date(), timeZone),
      }}
      success="Daily rate saved"
      contentClassName="sm:max-w-lg"
      onClose={onClose}
      run={(value) =>
        orpc.ipd.setBedTariff.call({
          orgSlug,
          categoryId: category.id,
          lines: value.lines,
          effectiveFrom: localDateTime(value.effectiveFrom, timeZone),
        })
      }
    >
      <TariffLines services={choices} />
      {servicesFooter}
      <p className="text-muted-foreground">
        Non-ICU room rent above ₹5,000 a day carries 5% GST on the whole amount. Set that rate on
        the room&apos;s service.
      </p>
      <TextField
        name="effectiveFrom"
        label="Starts"
        type="datetime-local"
        className="tabular-nums"
      />
    </FormDialog>
  );
}

function TariffLines({ services }: { services: Service[] }) {
  const { control } = useFormContext<TariffInput>();
  const lines = useFieldArray({ control, name: "lines", keyName: "fieldKey" });

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 font-medium">Charged each day</legend>
      <div
        aria-hidden
        className="grid grid-cols-[minmax(0,1fr)_7rem_1.5rem] gap-2 text-muted-foreground"
      >
        <span>Service</span>
        <span>Daily price</span>
      </div>
      {lines.fields.map((line, index) => (
        <div
          key={line.fieldKey}
          className="grid grid-cols-[minmax(0,1fr)_7rem_1.5rem] items-start gap-2"
        >
          <FormField
            control={control}
            name={`lines.${index}.catalogItemId`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <NativeSelect {...field} aria-label={`Service, line ${index + 1}`}>
                    <option value="">Choose a service</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <RegisteredFormField
            name={`lines.${index}.dailyPrice`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="decimal"
                    className="tabular-nums"
                    aria-label={`Daily price, line ${index + 1}`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="mt-1"
            aria-label={`Remove line ${index + 1}`}
            disabled={lines.fields.length === 1}
            onClick={() => lines.remove(index)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <LinesError />
      {lines.fields.length < MAX_LINES ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="self-start"
          onClick={() => lines.append(blankLine())}
        >
          Add line
        </Button>
      ) : null}
    </fieldset>
  );
}

/** The list-level error, such as a service chosen twice. */
function LinesError() {
  const { control } = useFormContext<TariffInput>();
  const { errors } = useFormState({ control, name: "lines", exact: true });
  const message = errors.lines?.root?.message ?? errors.lines?.message;

  return typeof message === "string" ? (
    <p role="alert" className="text-destructive">
      {message}
    </p>
  ) : null;
}
