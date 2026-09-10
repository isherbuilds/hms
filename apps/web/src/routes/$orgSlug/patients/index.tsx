import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";

import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useCan } from "@/lib/membership";
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

function PatientResults({ orgSlug, query }: { orgSlug: string; query: string }) {
  const { timeZone, today } = useOrgDateTime();
  const patients = useInfiniteQuery(patientSearchQuery(orgSlug, query));
  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel label="Registry" footer={<LoadMore query={patients} shown={items.length} />}>
      <ListState
        query={patients}
        errorTitle="Could not load patients"
        isEmpty={items.length === 0}
        empty={query ? "No patients match this search." : "No patients registered yet."}
      >
        <>
          <div className="hidden md:block">
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
                        className="font-medium capitalize underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
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
          </div>

          <ul className="md:hidden">
            {items.map((patient) => (
              <li key={patient.id}>
                <Link
                  to="/$orgSlug/patients/$patientId"
                  params={{ orgSlug, patientId: patient.id }}
                  className="block min-h-10 border-b px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono">{patient.mrn}</span>
                    <span className="min-w-0 truncate font-medium capitalize">{patient.name}</span>
                  </div>
                  <p className="mt-1 truncate font-mono tabular-nums">{patient.phone}</p>
                  <p className="mt-1 truncate text-muted-foreground">
                    <span className="capitalize">{patient.sex}</span>
                    {" · "}
                    {patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)}
                    {" · "}
                    {formatDate(patient.createdAt, timeZone)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      </ListState>
    </Panel>
  );
}

function PatientRegistry({ orgSlug }: { orgSlug: string }) {
  const [query, setQuery] = useState("");

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search patients"
          placeholder="Search name, MRN, or phone"
          onQueryChange={setQuery}
        />
      </ListToolbar>
      <PatientResults orgSlug={orgSlug} query={query} />
    </PageBody>
  );
}

export const Route = createFileRoute("/$orgSlug/patients/")({
  head: () => ({ meta: [{ title: "Patients · HMS" }] }),
  // Registration is a panel over this list, so its open state lives in the URL: the
  // link is shareable and Back closes it.
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(patientSearchQuery(orgSlug, "")).catch(() => {});
  },
  component: PatientsRoute,
});

function PatientsRoute() {
  const { orgSlug } = Route.useParams();
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const registerTrigger = useRef<HTMLButtonElement>(null);
  // Cashiers and accountants read the registry but cannot register.
  const canRegister = useCan(orgSlug, { patient: ["create"] });

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every patient registered in this organization"
        action={
          canRegister ? (
            <Button
              ref={registerTrigger}
              onClick={() => navigate({ search: (previous) => ({ ...previous, create: true }) })}
            >
              Register patient
            </Button>
          ) : undefined
        }
      />

      <PatientRegistry key={orgSlug} orgSlug={orgSlug} />

      {canRegister ? (
        <PatientSheet
          orgSlug={orgSlug}
          open={create === true}
          // The sheet opens from the URL, not a trigger inside it, so nothing hands focus
          // back to the button that opened it.
          onOpenChange={(open) => {
            void navigate({
              search: (previous) => ({ ...previous, create: open ? true : undefined }),
            }).then(() => {
              if (!open) registerTrigger.current?.focus();
            });
          }}
        />
      ) : null}
    </>
  );
}
