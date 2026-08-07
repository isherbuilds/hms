import { Button } from "@better-stack/ui/components/button";
import { Input } from "@better-stack/ui/components/input";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-stack/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { orpc } from "@/lib/orpc";

const patientSearchQuery = (orgSlug: string, query: string) =>
  orpc.patient.search.infiniteOptions({
    input: (cursor: { createdAt: Date; id: string } | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/org/$orgSlug/front-desk/")({
  component: FrontDeskRoute,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

function patientAge(dateOfBirth: string | null, ageYears: number | null): string {
  if (ageYears !== null) return String(ageYears);
  if (!dateOfBirth) return "—";

  const today = new Date();
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return String(age);
}

function FrontDeskRoute() {
  const { orgSlug } = Route.useParams();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const patients = useInfiniteQuery(patientSearchQuery(orgSlug, debouncedQuery));
  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Front desk"
        description="Find a patient by name, MRN, or phone number"
        action={
          <Button render={<Link to="/org/$orgSlug/front-desk/register" params={{ orgSlug }} />}>
            <PlusIcon />
            Register patient
          </Button>
        }
      />

      <div className="flex flex-col gap-3 p-4">
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

        {patients.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        ) : patients.isError ? (
          <div role="alert" className="border-l-2 border-destructive pl-3 text-xs">
            <p className="font-medium">Could not load patients</p>
            <p className="mt-0.5 text-muted-foreground">{patients.error.message}</p>
          </div>
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
                          to="/org/$orgSlug/front-desk/patients/$patientId"
                          params={{ orgSlug, patientId: patient.id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {patient.name}
                        </Link>
                      </TableCell>
                      <TableCell>{patient.phone}</TableCell>
                      <TableCell className="capitalize">{patient.sex}</TableCell>
                      <TableCell>{patientAge(patient.dateOfBirth, patient.ageYears)}</TableCell>
                      <TableCell>{dateFormatter.format(new Date(patient.createdAt))}</TableCell>
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
      </div>
    </>
  );
}
