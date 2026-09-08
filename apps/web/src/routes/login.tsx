import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SignInForm } from "@/components/sign-in-form";
import { redirectSignedInHome } from "@/lib/home";
import { safeRedirect } from "@/lib/safe-redirect";

export const Route = createFileRoute("/login")({
  ssr: true,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    // Unsafe values become undefined, not "/", so sign-in falls through to /join.
    redirect: safeRedirect(search.redirect, "") || undefined,
  }),
  // An already signed-in visitor skips the form. A deep link that bounced through
  // here keeps its destination; otherwise they go where sign-in would have sent them.
  beforeLoad: ({ search }) => redirectSignedInHome(search.redirect),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();

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
          <div className="flex flex-1 flex-col justify-center gap-6">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-lg font-medium tracking-tight">Sign in</h1>
              <p className="text-sm text-muted-foreground">
                New here? Open your hospital invitation to create an account.
              </p>
            </div>
            <SignInForm
              onSuccess={() => {
                if (redirect) void navigate({ href: redirect });
                else void navigate({ to: "/" });
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
