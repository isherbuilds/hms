import type { SettingsFields } from "@better-stack/api/routers/settings";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@better-stack/ui/components/form";
import { Input } from "@better-stack/ui/components/input";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { SubmitButton } from "@better-stack/ui/components/submit-button";
import { Textarea } from "@better-stack/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/admin/settings")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));
  },
  component: SettingsRoute,
});

/** Mirrors the router contract; messages here are for the person typing. */
const formSchema = z.object({
  legalName: z.string().trim().max(200, "Keep the legal name under 200 characters"),
  address: z.string().trim().max(500, "Keep the address under 500 characters"),
  taxId: z.string().trim().max(50, "Keep the tax id under 50 characters"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter code like INR"),
  mrnPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
  invoicePrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
  receiptPrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
  creditNotePrefix: z.string().trim().max(10, "Prefixes are at most 10 characters"),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  followUpValidityDays: z.number().int().min(1).max(365),
});

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

const SELECT_CLASS =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30";

function SettingsRoute() {
  const { orgSlug } = Route.useParams();
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Legal identity, currency, and document numbering for this organization"
      />
      <div className="max-w-2xl p-4">
        {settings.isError && (
          <div role="alert" className="border-l-2 border-destructive pl-3 text-xs">
            <p className="font-medium">Could not load settings</p>
            <p className="mt-0.5 text-muted-foreground">{settings.error.message}</p>
          </div>
        )}
        {settings.isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}
        {settings.data && (
          // Keyed by tenant: switching organizations remounts the form with
          // that org's values instead of carrying dirty state across.
          <SettingsForm key={orgSlug} orgSlug={orgSlug} defaults={settings.data} />
        )}
      </div>
    </>
  );
}

function SettingsForm({ orgSlug, defaults }: { orgSlug: string; defaults: SettingsFields }) {
  const queryClient = useQueryClient();
  const form = useZodForm(formSchema, { defaultValues: defaults });

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.settings.get.key({ input: { orgSlug } }),
        });
        // Saved values become the new pristine state, so the button disarms.
        form.reset(saved);
        toast.success("Settings saved");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const onSubmit = form.handleSubmit((values) => update.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">Organization</h2>
          <FormField
            control={form.control}
            name="legalName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Legal name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="As it should appear on invoices" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={3} placeholder="Printed under the legal name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="taxId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax id (GSTIN/PAN)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={3} className="uppercase" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">Document numbering</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="mrnPrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>MRN prefix</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="invoicePrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice prefix</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="receiptPrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receipt prefix</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="creditNotePrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credit note prefix</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="fiscalYearStartMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fiscal year starts in</FormLabel>
                  <FormControl>
                    <select
                      className={SELECT_CLASS}
                      value={field.value}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="followUpValidityDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Follow-up validity (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      {...field}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                    />
                  </FormControl>
                  <FormDescription>
                    Consult within this many days of the last visit bills the follow-up fee.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <div>
          <SubmitButton isSubmitting={update.isPending} disabled={!form.formState.isDirty}>
            Save settings
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
