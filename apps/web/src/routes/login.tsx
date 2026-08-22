import { Button } from "@hms/ui/components/button";
import { cn } from "@hms/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon, CheckIcon, EyeIcon, EyeOffIcon, LoaderIcon } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "@/lib/safe-redirect";

export const Route = createFileRoute("/login")({
  // Nothing here reads the session or touches browser-only APIs during render,
  // so this page server-renders per ADR 0003.
  ssr: true,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    // Only same-app absolute paths; anything else could bounce a fresh sign-in
    // to a foreign origin. Unsafe values become undefined rather than "/" so
    // the post-sign-in branch falls through to organization selection.
    redirect: safeRedirect(search.redirect, "") || undefined,
  }),
  component: LoginRoute,
});

const MIN_PASSWORD = 8;

/**
 * Underline fields rather than the system's bordered `Input`: this is the only
 * page in the product that is not a dense data surface, and a bordered box
 * would fight the single rounded action below it. Values are theme tokens and
 * scale steps — `text-sm` here is the public-page body size, not the app's.
 */
function Field({
  id,
  label,
  children,
  className,
  ...props
}: ComponentProps<"input"> & { id: string; label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          // The global `:focus-visible` outline in globals.css is unlayered, so
          // no utility can beat it — it has to be turned off inline, and this
          // field then owns its own indicator: a 2px rule that darkens to
          // `foreground` on focus. The border is 2px at rest too, so focusing
          // changes colour without shifting the text by a pixel.
          style={{ outline: "none" }}
          // `cn` last, not `{...props}` last: spreading the caller's className
          // straight onto the element replaced this whole string — which is how
          // the password field lost its underline.
          className={cn(
            "h-10 w-full border-0 border-b-2 border-border bg-transparent px-0 text-sm transition-colors duration-150 ease-out placeholder:text-muted-foreground/70 focus:border-foreground disabled:opacity-60",
            className,
          )}
          {...props}
        />
        {children}
      </div>
    </div>
  );
}

function LoginRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An invite recipient arrives signed out and is bounced here by /join,
  // so the invitation id rides along inside `redirect`. The invitation's org
  // and inviter are not readable before authentication — the copy stays
  // deliberately generic rather than naming something we cannot verify.
  const invited = redirect?.includes("invitation=") ?? false;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    let failure;
    try {
      ({ error: failure } = await authClient.signIn.email({ email: email.trim(), password }));
    } catch (thrown) {
      failure = { message: thrown instanceof Error ? thrown.message : undefined };
    } finally {
      setBusy(false);
    }

    if (failure) {
      setError(failure.message || "Could not sign you in. Check your details and try again.");
      return;
    }

    setDone(true);
    // A previous account's responses must not survive into this session.
    queryClient.clear();
    // Back to the page that sent us here; otherwise which org this tab works
    // in is decided next.
    if (redirect) {
      navigate({ href: redirect });
    } else {
      navigate({ to: "/join" });
    }
  };

  return (
    <div className="flex min-h-svh bg-background">
      {/* Context half, desktop only. A fixed dark surface in both themes — one
          of the two documented colour exceptions, the other being print. Inset
          by one step so the canvas frames it. Below lg the form is the whole
          page, so nothing here is load-bearing. */}
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
          <form onSubmit={submit} className="flex flex-1 flex-col justify-center gap-6">
            <div className="flex flex-col items-center gap-1 text-center">
              {invited && (
                <span className="mb-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
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

            <div className="flex flex-col gap-6">
              <Field
                id="email"
                label="Email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@hospital.in"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
                disabled={busy || done}
              />

              <Field
                id="password"
                label="Password"
                type={reveal ? "text" : "password"}
                required
                minLength={MIN_PASSWORD}
                autoComplete="current-password"
                className="pr-8"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                disabled={busy || done}
              >
                <button
                  type="button"
                  onClick={() => setReveal((value) => !value)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                >
                  {reveal ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </Field>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 border-l-2 border-destructive pl-3 text-sm text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                shape="pill"
                disabled={busy || done}
                className="h-11 w-full text-sm"
              >
                {busy && <LoaderIcon className="animate-spin" />}
                {done && <CheckIcon />}
                {busy
                  ? "Signing in…"
                  : done
                    ? "Signed in"
                    : invited
                      ? "Sign in and accept"
                      : "Sign in"}
              </Button>
            </div>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Locked out? Ask your administrator to reset your password.
          </p>
        </div>
      </div>
    </div>
  );
}
