import { normalizePhone } from "@hms/api/lib/phone";
import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@hms/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Monogram } from "@/components/monogram";
import { ErrorNote } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { MIN_SEARCH_CHARS } from "@/hooks/use-remote-search";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeLabel } from "@/lib/patient-age";

export type SelectedPatient = { id: string; name: string; mrn: string };

/** What `OpdPatientSearch` becomes once a patient is chosen. */
export function SelectedPatientChip({
  patient,
  onClear,
}: {
  patient: SelectedPatient;
  onClear: () => void;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2 bg-muted px-3">
      <Monogram label={patient.name} seed={patient.id} kind="patient" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-medium capitalize">{patient.name}</span>
        <span className="truncate font-mono text-muted-foreground">{patient.mrn}</span>
      </span>
      <Button type="button" size="xs" variant="ghost" onClick={onClear}>
        Change
      </Button>
    </div>
  );
}

// Larger than a type-ahead's window: namesakes are common and there is no page two.
const PATIENT_RESULT_LIMIT = 20;

const HAS_LETTERS = /\p{L}/u;

function phoneQuery(value: string) {
  const digits = normalizePhone(value);
  const hasLetters = HAS_LETTERS.test(value);
  const isPhone = !hasLetters && digits.length >= 4;

  return {
    isPhone,
    // A phone needs enough digits to narrow; a name needs enough letters.
    incomplete: !isPhone && (hasLetters ? value.length < MIN_SEARCH_CHARS : digits.length < 4),
  };
}

function callerSeed(value: string): { name?: string; phone?: string } {
  if (phoneQuery(value).isPhone) return { phone: value };

  return HAS_LETTERS.test(value) ? { name: value } : {};
}

// Uncontrolled: the DOM holds what is typed and only the settled term becomes
// state, so a keystroke never re-renders this component.
function PatientSearchInput({
  orgSlug,
  initialQuery,
  inputRef,
  onSelect,
  onRegister,
}: {
  orgSlug: string;
  initialQuery?: string;
  inputRef: { current: HTMLInputElement | null };
  onSelect: (patient: SelectedPatient) => void;
  onRegister: (seed: { name?: string; phone?: string }) => void;
}) {
  const { today } = useOrgDateTime();
  const [search, setSearch] = useState(() => initialQuery?.trim() ?? "");
  const [open, setOpen] = useState(false);
  const settle = useDebouncedCallback(setSearch, 300);
  const { isPhone, incomplete } = phoneQuery(search);

  const results = useQuery({
    ...orpc.patient.search.queryOptions({
      input: isPhone
        ? { orgSlug, phone: search, limit: PATIENT_RESULT_LIMIT }
        : { orgSlug, query: search, limit: PATIENT_RESULT_LIMIT },
    }),
    enabled: search.length > 0 && !incomplete,
  });

  const matches = results.data?.items ?? [];
  const searched = !incomplete && search.length > 0 && results.isSuccess;
  const error = results.isError ? results.error : null;

  const typed = () => inputRef.current?.value.trim() ?? search;

  const openRegistration = () => {
    setOpen(false);
    onRegister(callerSeed(typed()));
  };

  const renderMatch = (match: (typeof matches)[number]) => {
    const age = patientAgeLabel(match.dateOfBirth, match.dobEstimated, today);

    return (
      <>
        <span className="min-w-0">
          <span className="block truncate font-medium capitalize">{match.name}</span>
          <span className="block truncate text-muted-foreground">
            <span className="font-mono">{match.mrn}</span> ·{" "}
            <span className="font-mono tabular-nums">{match.phone}</span>
          </span>
        </span>
        <span className="shrink-0 tabular-nums capitalize text-muted-foreground">
          {age}y · {match.sex}
        </span>
      </>
    );
  };

  return (
    <>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Combobox
          items={matches}
          getItemKey={(match) => match.id}
          getItemLabel={(match) => match.name}
          defaultInputValue={initialQuery}
          onInputValueChange={(value) => settle(value.trim())}
          onSelect={(match) => {
            setOpen(false);
            onSelect({ id: match.id, name: match.name, mrn: match.mrn });
          }}
          open={open}
          onOpenChange={setOpen}
          inputRef={inputRef}
          inputClassName="pl-8"
          inputProps={{
            id: "patient-search",
            "aria-label": "Phone or name",
            placeholder: "Phone or name",
            autoComplete: "off",
            autoFocus: true,
            onFocus: () => {
              if (typed().length > 0) setOpen(true);
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !searched || matches.length > 0) return;
              event.preventDefault();
              openRegistration();
            },
          }}
          itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2"
          renderItem={renderMatch}
          emptyContent={
            results.isPending && !incomplete && search.length > 0 ? (
              <p className="px-3 py-2 text-muted-foreground">Searching…</p>
            ) : searched ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No patient matches “{search}”</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={openRegistration}>
                    Register new patient
                  </Button>
                </EmptyContent>
              </Empty>
            ) : undefined
          }
        />
      </div>

      {error ? <ErrorNote title="Could not search patients" error={error} /> : null}
    </>
  );
}

export function OpdPatientSearch({
  orgSlug,
  initialQuery,
  onSelect,
}: {
  orgSlug: string;
  initialQuery?: string;
  onSelect: (patient: SelectedPatient) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [seed, setSeed] = useState<{ name?: string; phone?: string } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <PatientSearchInput
        orgSlug={orgSlug}
        initialQuery={initialQuery}
        inputRef={searchRef}
        onSelect={onSelect}
        onRegister={setSeed}
      />

      <PatientSheet
        orgSlug={orgSlug}
        seed={seed ?? undefined}
        open={seed !== null}
        onOpenChange={() => {
          setSeed(null);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        onRegistered={(patient) => {
          setSeed(null);
          onSelect(patient);
        }}
      />
    </div>
  );
}
