import type { SettingsFields } from "@hms/api/routers/settings";
import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useFormContext, useFormState } from "react-hook-form";
import { z } from "zod";

import { numberText } from "@/lib/form-schema";

import { TextField } from "@/components/form-fields";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/organization")({
  head: () => ({ meta: [{ title: "Organization · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // The page is a save form, so the tab strip gates it on `update` too.
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { settings: ["update"] },
      "/$orgSlug/settings",
    );
    await queryClient.query(orpc.settings.get.queryOptions({ input: { orgSlug } })).catch(() => {});
  },
  component: SettingsRoute,
});

const supportedTimeZones = Intl.supportedValuesOf("timeZone");

// Probe rather than list membership: engines disagree on canonical ids
// (JavaScriptCore lists Asia/Calcutta, V8 Asia/Kolkata). Mirrors the router.
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

const formSchema = z
  .object({
    legalName: z.string().trim().max(200, "Keep the legal name under 200 characters"),
    address: z.string().trim().max(500, "Keep the address under 500 characters"),
    taxId: z.string().trim().max(50, "Keep the tax id under 50 characters"),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter code like INR"),
    timeZone: z.string().refine(isSupportedTimeZone, {
      message: "Use a valid IANA time zone like Asia/Kolkata",
    }),
    mrnPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    invoicePrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    receiptPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    advanceReceiptPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    creditNotePrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    pharmacyInvoicePrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
    fiscalYearStartMonth: numberText(
      z.number().int().min(1, "Pick a month").max(12, "Pick a month"),
    ),
    followUpValidityDays: numberText(
      z.number().int().min(1, "Between 1 and 365 days").max(365, "Between 1 and 365 days"),
    ),
    unbilledAlertHours: numberText(
      z.number().int().min(1, "Between 1 and 168 hours").max(168, "Between 1 and 168 hours"),
    ),
  })
  // Mirrors the server refusal: both invoice streams share one number namespace.
  .superRefine((value, context) => {
    if (value.invoicePrefix === value.pharmacyInvoicePrefix) {
      context.addIssue({
        code: "custom",
        path: ["pharmacyInvoicePrefix"],
        message: "Use a different prefix from the OPD invoice prefix",
      });
    }
  });

function toFormValues(settings: SettingsFields) {
  return {
    ...settings,
    fiscalYearStartMonth: String(settings.fiscalYearStartMonth),
    followUpValidityDays: String(settings.followUpValidityDays),
    unbilledAlertHours: String(settings.unbilledAlertHours),
  };
}

type SettingsFormValues = z.input<typeof formSchema>;

function SettingsSubmitButton({ pending }: { pending: boolean }) {
  const { control } = useFormContext<SettingsFormValues>();
  const { isDirty } = useFormState({ control });

  return (
    <SubmitButton isSubmitting={pending} disabled={!isDirty}>
      Save settings
    </SubmitButton>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function SettingsRoute() {
  const { orgSlug } = Route.useParams();
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  return (
    <>
      <PageHeader title="Organization" />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody className="max-w-2xl">
        {settings.isError && <ErrorNote title="Could not load settings" error={settings.error} />}

        {settings.data && (
          // Keyed by tenant: switching organizations remounts the form instead of carrying
          // dirty state across.
          <SettingsForm key={orgSlug} orgSlug={orgSlug} defaults={settings.data} />
        )}
      </PageBody>
    </>
  );
}

function SettingsForm({ orgSlug, defaults }: { orgSlug: string; defaults: SettingsFields }) {
  const router = useRouter();
  const form = useZodForm(formSchema, { defaultValues: toFormValues(defaults) });

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: async (saved) => {
        form.reset(toFormValues(saved));
        toast.success("Settings saved");
        // The org layout loader holds the time zone every page formats with.
        await router.invalidate();
      },
    }),
  );

  const onSubmit = form.handleSubmit((values) => update.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        {/* Frozen while saving: `onSuccess` resets to the saved row, which would
            otherwise discard anything typed during the request. */}
        <fieldset disabled={update.isPending} className="contents">
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-medium text-muted-foreground">Organization</h2>
            <TextField
              name="legalName"
              label="Legal name"
              placeholder="As it should appear on invoices"
            />
            <TextField
              name="address"
              label="Address"
              multiline
              rows={3}
              placeholder="Printed under the legal name"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="taxId" label="Tax id (GSTIN/PAN)" />
              {/* Hand-written: `TextField`'s `className` places the row, so it cannot also
                  carry the control's own class. */}
              <RegisteredFormField
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={3} readOnly className="uppercase" />
                    </FormControl>
                    <FormDescription>
                      Fixed for this organization so historical amounts keep one meaning.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <RegisteredFormField
              name="timeZone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time zone</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {/* Keep a stored zone selectable even when this browser's canonical list omits it. */}
                      {defaults.timeZone && !supportedTimeZones.includes(defaults.timeZone) ? (
                        <option value={defaults.timeZone}>{defaults.timeZone}</option>
                      ) : null}
                      {supportedTimeZones.map((timeZone) => (
                        <option key={timeZone} value={timeZone}>
                          {timeZone}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormDescription>
                    Sets the local date used for queues, numbering, and reports. Changing it applies
                    to new records; existing ones keep their date.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-medium text-muted-foreground">Document numbering</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="mrnPrefix" label="MRN prefix" />
              <TextField name="invoicePrefix" label="Invoice prefix" />
              <TextField name="pharmacyInvoicePrefix" label="Pharmacy invoice prefix" />
              <TextField name="receiptPrefix" label="Receipt prefix" />
              <TextField name="creditNotePrefix" label="Credit note prefix" />
              <TextField name="advanceReceiptPrefix" label="Advance receipt prefix" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <RegisteredFormField
                name="fiscalYearStartMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fiscal year starts in</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {MONTHS.map((month, index) => (
                          <option key={month} value={index + 1}>
                            {month}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <TextField
                name="followUpValidityDays"
                label="Follow-up validity (days)"
                type="number"
                min={1}
                max={365}
                step={1}
                description="Consult within this many days of the last appointment bills the follow-up fee."
              />
              <TextField
                name="unbilledAlertHours"
                label="Unbilled alert (hours)"
                type="number"
                min={1}
                max={168}
                step={1}
                description="Checked-in visits with charges older than this appear as unbilled"
              />
            </div>
          </section>
        </fieldset>

        <div>
          <SettingsSubmitButton pending={update.isPending} />
        </div>
      </form>
    </Form>
  );
}
