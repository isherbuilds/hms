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
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeYears } from "@/lib/patient-age";

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
    q: z
      .string()
      .trim()
      .optional()
      .catch(undefined)
      .transform((value) => value || undefined),
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await queryClient.prefetchInfiniteQuery(patientSearchQuery(orgSlug, deps.q ?? ""));
  },
  component: PatientsRoute,
});

function PatientsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone, today } = useOrgDateTime();
  const [query, setQuery] = useState(() => q ?? "");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const lastUrlQuery = useRef(q);

  // An external URL change (Back, a shared link) adopts the new value; our own
  // debounced writes are recorded in lastUrlQuery so they do not clobber
  // whatever the user has typed since.
  useEffect(() => {
    if (q !== lastUrlQuery.current) {
      lastUrlQuery.current = q;
      setQuery(q ?? "");
    }
  }, [q]);

  useEffect(() => {
    // A stale debounce (still catching up to the input) must not navigate:
    // right after a Back-sync it would re-write the URL we just adopted.
    if (debouncedQuery !== query.trim()) return;
    const nextQuery = debouncedQuery || undefined;
    if (nextQuery === q) return;

    lastUrlQuery.current = nextQuery;
    void navigate({
      search: (previous) => ({ ...previous, q: nextQuery }),
      replace: true,
    });
  }, [debouncedQuery, query, navigate, q]);

  const patients = useInfiniteQuery({
    ...patientSearchQuery(orgSlug, debouncedQuery),
    placeholderData: keepPreviousData,
  });
  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Patients"
        action={
          <Button
            onClick={() => navigate({ search: (previous) => ({ ...previous, create: true }) })}
          >
            <PlusIcon />
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

        {patients.isPending ? null : patients.isError ? (
          <ErrorNote title="Could not load patients" detail={patients.error.message} />
        ) : items.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            {debouncedQuery ? "No patients match this search." : "No patients registered yet."}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MRN</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Sex</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((patient) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-mono text-xs">{patient.mrn}</TableCell>
                      <TableCell>
                        <Link
                          to="/$orgSlug/patients/$patientId"
                          params={{ orgSlug, patientId: patient.id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {patient.name}
                        </Link>
                      </TableCell>
                      <TableCell>{patient.phone}</TableCell>
                      <TableCell className="capitalize">{patient.sex}</TableCell>
                      <TableCell>
                        {patientAgeYears(patient.dateOfBirth, patient.ageYears, today) ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(patient.createdAt, timeZone)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {patients.hasNextPage ? (
              <Button
                variant="outline"
                className="self-start"
                disabled={patients.isFetchingNextPage}
                onClick={() => patients.fetchNextPage()}
              >
                {patients.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        )}
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
