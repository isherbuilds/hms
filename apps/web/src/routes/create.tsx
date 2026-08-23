import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { ORGANIZATION_SLUG_MIN_LENGTH, organizationSlugIssue } from "@hms/auth/organization-slug";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, LoaderIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { authClient } from "@/lib/auth-client";

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

function CreateOrganizationRoute() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slugIssue = organizationSlugIssue(slug);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (slugIssue) return;
    setBusy(true);

    try {
      const { data, error: failure } = await authClient.organization.create({
        name: name.trim(),
        slug,
      });
      if (failure) {
        // The address being taken is the one failure a person can act on, and
        // the database is what decides it — there is no pre-check to trust.
        const taken =
          failure.code === "ORGANIZATION_SLUG_ALREADY_TAKEN" ||
          failure.code === "ORGANIZATION_ALREADY_EXISTS";
        setError(
          taken
            ? `The address "${slug}" is already taken. Try another.`
            : failure.message || "This organization could not be created.",
        );
        return;
      }

      setDone(true);
      await navigate({ to: "/$orgSlug/onboarding", params: { orgSlug: data.slug } });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "This organization could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

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
      <form onSubmit={submit} className="flex flex-col gap-6">
        <div>
          <h2 className="text-sm font-medium">Organization details</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Creation is restricted to the deployment&apos;s founding operator.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="organization-name" className="text-xs font-medium">
            Organization name
          </label>
          <Input
            id="organization-name"
            name="organizationName"
            value={name}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              if (!slugEdited) setSlug(slugFrom(nextName));
              setError(null);
            }}
            placeholder="Mercy General Hospital"
            autoComplete="organization"
            required
            disabled={busy || done}
          />
        </div>

        <div className="flex flex-col gap-2 border-l-2 border-foreground bg-muted/35 px-3 py-2">
          <label
            htmlFor="organization-slug"
            className="font-mono text-xs tracking-widest text-muted-foreground"
          >
            ORGANIZATION ADDRESS
          </label>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
              /
            </span>
            <Input
              id="organization-slug"
              name="organizationSlug"
              value={slug}
              onChange={(event) => {
                setSlug(slugFrom(event.target.value));
                setSlugEdited(true);
                setError(null);
              }}
              aria-describedby="organization-slug-help"
              aria-invalid={Boolean(slug && slugIssue)}
              className="h-7 font-mono"
              placeholder="mercy-general"
              autoComplete="off"
              spellCheck={false}
              minLength={ORGANIZATION_SLUG_MIN_LENGTH}
              required
              disabled={busy || done}
            />
          </div>
          <p
            id="organization-slug-help"
            aria-live="polite"
            className={
              slug && slugIssue ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {slug && slugIssue
              ? slugIssue
              : `At least ${ORGANIZATION_SLUG_MIN_LENGTH} characters. This permanent URL cannot be changed later.`}
          </p>
        </div>

        {error && <ErrorNote title={error} />}

        <Button
          type="submit"
          disabled={busy || done || !name.trim() || Boolean(slugIssue)}
          className="w-full"
        >
          {busy ? (
            <LoaderIcon className="animate-spin" />
          ) : done ? (
            <CheckIcon />
          ) : (
            <ArrowRightIcon />
          )}
          {busy ? "Creating…" : done ? "Created" : "Create organization"}
        </Button>
      </form>
    </OrganizationEntryLayout>
  );
}
