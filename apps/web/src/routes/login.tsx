import { Button } from "@better-stack/ui/components/button";
import { Input } from "@better-stack/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ComponentProps, type FormEvent } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "@/utils/safe-redirect";

export const Route = createFileRoute("/login")({
  // Nothing here reads the session or touches browser-only APIs during render,
  // so this page server-renders per ADR 0003.
  ssr: true,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    // Only same-app absolute paths; anything else could bounce a fresh sign-in
    // to a foreign origin. Unsafe values become undefined rather than "/" so
    // the post-sign-in branch falls through to onboarding.
    redirect: safeRedirect(search.redirect, "") || undefined,
  }),
  component: LoginRoute,
});

const MIN_PASSWORD = 8;

function Field({
  id,
  label,
  hint,
  ...props
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <Input id={id} name={id} {...props} />
      {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LoginRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    let error;
    try {
      ({ error } = await authClient.signIn.email({ email: email.trim(), password }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : undefined };
    } finally {
      setBusy(false);
    }

    if (error) {
      toast.error(error.message || "Could not sign you in. Check your details and try again.");
      return;
    }
    // A previous account's responses must not survive into this session.
    queryClient.clear();
    // Back to the page that sent us here; otherwise which org this tab works
    // in is decided next.
    if (redirect) {
      navigate({ href: redirect });
    } else {
      navigate({ to: "/onboarding" });
    }
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="cn-font-heading text-sm font-medium">Sign in</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Accounts are created by your organization's administrator.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 p-3 ring-1 ring-border">
        <Field
          id="email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />

        <Button type="submit" disabled={busy} className="mt-1">
          {busy ? "Working…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
