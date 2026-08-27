import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeLabel } from "@/lib/patient-age";

const patientSearchQuery = (orgSlug: string, query: string) =>
  orpc.patient.search.infiniteOptions({
    input: (cursor: string | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/patients/")({
  head: () => ({ meta: [{ title: "Patients · HMS" }] }),
  // Registration is a panel over this list rather than a page of its own, so
  // its open state lives in the URL: the link is shareable and Back closes it.
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.prefetchInfiniteQuery(patientSearchQuery(orgSlug, ""));
  },
  component: PatientsRoute,
});

function PatientsRoute() {
  const { orgSlug } = Route.useParams();
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone, today } = useOrgDateTime();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const patients = useInfiniteQuery({
    ...patientSearchQuery(orgSlug, debouncedQuery),
    placeholderData: keepPreviousData,
  });
  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every patient registered in this organization"
        action={
          <Button
            onClick={() => navigate({ search: (previous) => ({ ...previous, create: true }) })}
          >
            Register patient
          </Button>
        }
      />

      <PageBody>
        <div className="relative max-w-md">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, MRN, or phone"
            aria-label="Search patients"
            className="pl-8"
          />
        </div>

        {/* The registry in the house card-in-card language (docs/design.md
            §1): the tinted tray carries the label, the raised card carries the
            rows, and it holds its height through a pending read, a failed one
            and a search that matches nobody. */}
        <section className="flex flex-col rounded-xl bg-muted p-1">
          <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
            <span className="min-w-0 truncate">Registry</span>
          </div>
          <div className="min-h-32 overflow-hidden rounded-lg border border-border bg-card">
            {patients.isPending ? null : patients.isError ? (
              <ErrorNote title="Could not load patients" detail={patients.error.message} inset />
            ) : items.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center px-4 text-center text-muted-foreground">
                {debouncedQuery ? "No patients match this search." : "No patients registered yet."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MRN</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Sex</TableHead>
                    <TableHead className="w-16 text-right">Age</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((patient) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-mono">{patient.mrn}</TableCell>
                      <TableCell>
                        <Link
                          to="/$orgSlug/patients/$patientId"
                          params={{ orgSlug, patientId: patient.id }}
                          className="font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {patient.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">{patient.phone}</TableCell>
                      <TableCell className="capitalize">{patient.sex}</TableCell>
                      <TableCell className="text-right">
                        {patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(patient.createdAt, timeZone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Under the list only: every other state is the card's business. */}
        {!patients.isError && items.length > 0 && patients.hasNextPage ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={patients.isFetchingNextPage}
            onClick={() => patients.fetchNextPage()}
          >
            {patients.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </PageBody>

      <PatientSheet
        orgSlug={orgSlug}
        open={create === true}
        onOpenChange={(open) =>
          navigate({
            search: (previous) => ({ ...previous, create: open ? true : undefined }),
          })
        }
      />
    </>
  );
}
