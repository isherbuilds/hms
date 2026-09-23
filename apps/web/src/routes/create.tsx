import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Form,
  FormControl,
  FormFieldset,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { ORGANIZATION_SLUG_MIN_LENGTH, organizationSlugIssue } from "@hms/auth/organization-slug";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useRef } from "react";
import { Watch, useFormContext, useFormState } from "react-hook-form";
import { z } from "zod";

import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { useZodForm } from "@/hooks/use-zod-form";

export const Route = createFileRoute("/create")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();

    if (!session.data) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: CreateOrganizationRoute,
});

function slugFrom(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const createOrganizationSchema = z.object({
  organizationName: z.string().trim().min(1, "Enter an organization name"),
  organizationSlug: z
    .string()
    .transform(slugFrom)
    .superRefine((slug, context) => {
      const message = organizationSlugIssue(slug);

      if (message) context.addIssue({ code: "custom", message });
    }),
});

function CreateOrganizationRoute() {
  return (
    <OrganizationEntryLayout
      eyebrow="CREATE ORGANIZATION"
      title="Bring this hospital into HMS."
      description="The address names the organization in every tab and shared link. Data and permissions stay isolated behind it."
      aside={
        <p>
          Have an invitation?{" "}
          <Link to="/join" className="text-foreground underline underline-offset-4">
            Join an organization
          </Link>
        </p>
      }
    >
      <CreateOrganizationForm />
    </OrganizationEntryLayout>
  );
}

function CreateOrganizationForm() {
  const navigate = useNavigate();
  const slugEdited = useRef(false);

  const form = useZodForm(createOrganizationSchema, {
    defaultValues: { organizationName: "", organizationSlug: "" },
  });

  const submit = form.handleSubmit(async ({ organizationName, organizationSlug }) => {
    form.clearErrors("root.server");

    const { data, error } = await authClient.organization.create({
      name: organizationName,
      slug: organizationSlug,
    });

    if (error) {
      const taken =
        error.code === "ORGANIZATION_SLUG_ALREADY_TAKEN" ||
        error.code === "ORGANIZATION_ALREADY_EXISTS";

      form.setError("root.server", {
        message: taken
          ? `The address "${organizationSlug}" is already taken. Try another.`
          : error.message || "This organization could not be created.",
      });

      return;
    }

    void navigate({ to: "/$orgSlug/onboarding", params: { orgSlug: data.slug } });
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Organization details</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            Creation is restricted to the deployment&apos;s founding operator.
          </p>
        </div>

        <FormFieldset className="flex flex-col gap-6">
          <OrganizationNameField
            onNameChange={(name) => {
              if (!slugEdited.current) form.setValue("organizationSlug", slugFrom(name));
            }}
          />
          <OrganizationSlugField
            onSlugEdit={() => {
              slugEdited.current = true;
            }}
          />
          <CreateError />
          <CreateButton />
        </FormFieldset>
      </form>
    </Form>
  );
}

function OrganizationNameField({ onNameChange }: { onNameChange: (name: string) => void }) {
  return (
    <RegisteredFormField
      name="organizationName"
      rules={{ onChange: (event) => onNameChange(event.target.value) }}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs font-medium">Organization name</FormLabel>
          <FormControl>
            <Input
              {...field}
              placeholder="Mercy General Hospital"
              autoComplete="organization"
              autoFocus
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function OrganizationSlugField({ onSlugEdit }: { onSlugEdit: () => void }) {
  const { control, setValue } = useFormContext();

  return (
    <div className="flex flex-col gap-2">
      <RegisteredFormField
        name="organizationSlug"
        rules={{
          onChange: onSlugEdit,
          // Normalised on blur, not per keystroke, so the caret never jumps.
          onBlur: (event) => setValue("organizationSlug", slugFrom(event.target.value)),
        }}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs tracking-widest text-muted-foreground">
              ORGANIZATION ADDRESS
            </FormLabel>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                /
              </span>
              <FormControl>
                <Input
                  {...field}
                  className="h-7 font-mono"
                  placeholder="mercy-general"
                  autoComplete="off"
                  spellCheck={false}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <Watch
        control={control}
        name="organizationSlug"
        exact
        render={(value) => (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Saved as /{slugFrom(String(value ?? "")) || "mercy-general"} — at least{" "}
            {ORGANIZATION_SLUG_MIN_LENGTH} characters, and permanent.
          </p>
        )}
      />
    </div>
  );
}

function CreateError() {
  const { control } = useFormContext();
  const { errors } = useFormState({ control });
  const message = errors.root?.server?.message;

  return message ? <ErrorNote title={message} /> : null;
}

function CreateButton() {
  const { control } = useFormContext();
  const { isSubmitting } = useFormState({ control });

  return (
    <SubmitButton isSubmitting={isSubmitting} className="w-full">
      <ArrowRightIcon />
      Create organization
    </SubmitButton>
  );
}
