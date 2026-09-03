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

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every patient registered in this organization"
        action={
          <Button
            ref={registerTrigger}
            onClick={() => navigate({ search: (previous) => ({ ...previous, create: true }) })}
          >
            Register patient
          </Button>
        }
      />

      <PatientRegistry key={orgSlug} orgSlug={orgSlug} />

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
    </>
  );
}
