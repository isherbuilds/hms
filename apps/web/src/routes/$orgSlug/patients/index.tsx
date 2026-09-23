import { Button } from "@hms/ui/components/button";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
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
import { VenusAndMarsIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { Monogram } from "@/components/monogram";
import { PatientSheet } from "@/components/patient-sheet";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeLabel } from "@/lib/patient-age";

// "unknown" is a recorded answer, so it filters like any other.
const PATIENT_SEX = ["male", "female", "other", "unknown"] as const;

type PatientFilters = { q?: string; sex?: (typeof PATIENT_SEX)[number] };

const SEX_LABELS = {
  male: "Male",
  female: "Female",
  other: "Other",
  unknown: "Unknown",
} as const;

const patientSearchQuery = (orgSlug: string, filters: PatientFilters) =>
  orpc.patient.search.infiniteOptions({
    input: (cursor: string | undefined) => ({
      orgSlug,
      query: filters.q,
      sex: filters.sex,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Typing keeps the previous matches on screen; a blank list between keystrokes
    // reads as "nothing found".
    placeholderData: keepPreviousData,
  });

function PatientResults({ orgSlug, filters }: { orgSlug: string; filters: PatientFilters }) {
  const { timeZone, today } = useOrgDateTime();
  const patients = useInfiniteQuery(patientSearchQuery(orgSlug, filters));
  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel grow footer={<LoadMore query={patients} shown={items.length} />}>
      <ListState
        query={patients}
        errorTitle="Could not load patients"
        isEmpty={items.length === 0}
        empty={
          filters.q
            ? "No patients match this search."
            : filters.sex
              ? "No patients match these filters."
              : "No patients registered yet."
        }
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
                  <TableRow key={patient.id} className="relative">
                    <TableCell className="font-mono">{patient.mrn}</TableCell>
                    <TableCell>
                      <Link
                        to="/$orgSlug/patients/$patientId"
                        params={{ orgSlug, patientId: patient.id }}
                        className="inline-flex items-center gap-2 font-medium capitalize underline-offset-4 after:absolute after:inset-0 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        <Monogram label={patient.name} seed={patient.id} kind="patient" />
                        <span>{patient.name}</span>
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
                  <div className="flex min-w-0 items-center gap-2">
                    <Monogram label={patient.name} seed={patient.id} kind="patient" />
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

export const Route = createFileRoute("/$orgSlug/patients/")({
  head: () => ({ meta: [{ title: "Patients · HMS" }] }),
  // Registration is a panel over this list, so its open state lives in the URL: the
  // link is shareable and Back closes it.
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    sex: z.enum(PATIENT_SEX).optional().catch(undefined),
  }),
  // `create` stays out: opening the sheet must not refetch the registry.
  loaderDeps: ({ search: { q, sex } }) => ({ q, sex }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(patientSearchQuery(orgSlug, deps)).catch(() => {});
  },
  component: PatientsRoute,
});

function PatientsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, ...filters } = Route.useSearch();
  const { q, sex } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const registerTrigger = useRef<HTMLButtonElement>(null);
  // Cashiers and accountants read the registry but cannot register.
  const canRegister = useCan(orgSlug, { patient: ["create"] });

  const setFilters = (patch: PatientFilters) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, sex: undefined });
  };

  const chips: ActiveFilter[] =
    sex === undefined
      ? []
      : [
          {
            id: "sex",
            name: "Sex",
            label: SEX_LABELS[sex],
            remove: () => setFilters({ sex: undefined }),
          },
        ];

  return (
    <>
      <PageHeader
        title="Patients"
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

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search patients"
            placeholder="Search name, MRN, or phone"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={VenusAndMarsIcon} label="Sex">
                  {PATIENT_SEX.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={sex === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({ sex: checked ? candidate : undefined })
                      }
                    >
                      {SEX_LABELS[candidate]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>
        <PatientResults key={orgSlug} orgSlug={orgSlug} filters={filters} />
      </PageBody>

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
