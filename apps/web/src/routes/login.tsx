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
import { cn } from "@hms/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { z } from "zod";

import { ErrorNote } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "@/lib/safe-redirect";
import { useZodForm } from "@/hooks/use-zod-form";

export const Route = createFileRoute("/login")({
  ssr: true,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    // Unsafe values become undefined, not "/", so sign-in falls through to /join.
    redirect: safeRedirect(search.redirect, "") || undefined,
  }),
  component: LoginRoute,
});

const MIN_PASSWORD = 8;
const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  password: z.string().min(MIN_PASSWORD, `Password must be at least ${MIN_PASSWORD} characters.`),
});

// The `:focus-visible` outline in globals.css is unlayered, so no utility can beat
// it: it is turned off inline and the bottom border is the focus indicator.
const underline =
  "h-10 w-full border-0 border-b-2 border-border bg-transparent px-0 text-sm transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground/70 focus:border-foreground disabled:opacity-60";

function LoginRoute() {
  const { redirect } = Route.useSearch();
  const invited = redirect?.includes("invitation=") ?? false;

  return (
    <main id="main" tabIndex={-1} className="flex min-h-svh bg-background">
      <div className="relative m-2 hidden overflow-hidden rounded-lg bg-neutral-950 lg:flex lg:w-1/2">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-teal-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-indigo-500/15 blur-3xl"
        />
        <div className="relative flex w-full flex-col justify-end gap-2 p-8">
          <p className="max-w-md text-xl leading-snug font-medium tracking-tight text-white">
            From the first token of the morning to the day-close, one ledger.
          </p>
          <p className="text-sm text-white/50">
            Registration, queue, billing and reports for the whole hospital.
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center p-8 lg:w-1/2">
        <div className="flex h-full w-full max-w-sm flex-col">
          <LoginForm invited={invited} redirect={redirect} />

          <p className="text-center text-xs text-muted-foreground">
            Locked out? Ask your administrator to reset your password.
          </p>
        </div>
      </div>
    </main>
  );
}

function LoginForm({ invited, redirect }: { invited: boolean; redirect?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  const submit = form.handleSubmit(async ({ email, password }) => {
    form.clearErrors("root.server");

    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      form.setError("root.server", {
        message: error.message || "Could not sign you in. Check your details and try again.",
      });
      return;
    }

    // A previous account's responses must not survive into this session.
    queryClient.clear();
    if (redirect) {
      void navigate({ href: redirect });
    } else {
      void navigate({ to: "/join" });
    }
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          {invited && (
            <span className="mb-2 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
              You have an invitation
            </span>
          )}
          <h1 className="text-lg font-medium tracking-tight">
            {invited ? "Accept your invitation" : "Sign in"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invited
              ? "Sign in with the invited account to join."
              : "Accounts are created by your administrator."}
          </p>
        </div>

        <FormFieldset className="flex flex-col gap-6">
          <EmailField />
          <PasswordField />
          <SignInError />
          <SignInButton invited={invited} />
        </FormFieldset>
      </form>
    </Form>
  );
}

function EmailField() {
  return (
    <RegisteredFormField
      name="email"
      render={({ field }) => (
        <FormItem className="gap-1">
          <FormLabel className="text-xs font-medium tracking-wide text-muted-foreground">
            Email
          </FormLabel>
          <FormControl>
            <input
              {...field}
              type="email"
              required
              autoComplete="email"
              placeholder="you@hospital.in"
              className={underline}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PasswordField() {
  const [reveal, setReveal] = useState(false);

  return (
    <RegisteredFormField
      name="password"
      render={({ field }) => (
        <FormItem className="gap-1">
          <FormLabel className="text-xs font-medium tracking-wide text-muted-foreground">
            Password
          </FormLabel>
          <div className="relative">
            <FormControl>
              <input
                {...field}
                type={reveal ? "text" : "password"}
                required
                autoComplete="current-password"
                className={cn(underline, "pr-8")}
              />
            </FormControl>
            <button
              type="button"
              onClick={() => setReveal((value) => !value)}
              aria-label={reveal ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
            >
              {reveal ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SignInError() {
  const { control } = useFormContext();
  const { errors } = useFormState({ control });
  const message = errors.root?.server?.message;

  return message ? <ErrorNote title={message} /> : null;
}

function SignInButton({ invited }: { invited: boolean }) {
  const { control } = useFormContext();
  const { isSubmitting } = useFormState({ control });

  return (
    <SubmitButton isSubmitting={isSubmitting} shape="pill" className="h-11 w-full text-sm">
      {invited ? "Sign in and accept" : "Sign in"}
    </SubmitButton>
  );
}
