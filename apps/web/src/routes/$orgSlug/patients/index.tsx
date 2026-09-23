import { Button } from "@hms/ui/components/button";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  DataList,
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
            ? "No matching patients"
            : filters.sex
              ? "No patients match these filters"
              : "No patients yet"
        }
      >
        <DataList
          columns={[
            {
              head: "Name",
              cell: (patient) => (
                <span className="inline-flex items-center gap-2 capitalize">
                  <Monogram label={patient.name} seed={patient.id} kind="patient" />
                  <span>{patient.name}</span>
                </span>
              ),
            },
            {
              head: "MRN",
              cell: (patient) => <span className="font-mono">{patient.mrn}</span>,
              mobile: "title",
            },
            {
              head: "Phone",
              cell: (patient) => <span className="font-mono tabular-nums">{patient.phone}</span>,
            },
            {
              head: "Sex",
              cell: (patient) => <span className="capitalize">{patient.sex}</span>,
            },
            {
              head: "Age",
              cell: (patient) => (
                <span className="tabular-nums">
                  {patientAgeLabel(patient.dateOfBirth, patient.dobEstimated, today)}
                </span>
              ),
              className: "w-16 text-right",
            },
            {
              head: "Created",
              cell: (patient) => (
                <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatDate(patient.createdAt, timeZone)}
                </span>
              ),
            },
          ]}
          rows={items}
          rowKey={(patient) => patient.id}
          link={(patient) => ({
            to: "/$orgSlug/patients/$patientId",
            params: { orgSlug, patientId: patient.id },
          })}
        />
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
            placeholder="Name, MRN, or phone"
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
