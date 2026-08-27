import { normalizePhone } from "@hms/api/lib/phone";
import { Button } from "@hms/ui/components/button";
import { Combobox } from "@hms/ui/components/combobox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@hms/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorNote } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeLabel } from "@/lib/patient-age";

export type SelectedPatient = { id: string; name: string; mrn: string };

const HAS_LETTERS = /\p{L}/u;

function phoneQuery(value: string) {
  const digits = normalizePhone(value);
  const hasLetters = HAS_LETTERS.test(value);
  return {
    isPhone: !hasLetters && digits.length >= 4,
    incomplete: !hasLetters && digits.length < 4,
  };
}

function callerSeed(value: string): { name?: string; phone?: string } {
  const classification = phoneQuery(value);
  if (classification.isPhone) return { phone: value };
  if (classification.incomplete) return {};
  return { name: value };
}

function usePatientMatches(orgSlug: string, raw: string) {
  const trimmed = raw.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const { isPhone, incomplete } = phoneQuery(debounced);

  const results = useQuery({
    ...orpc.patient.search.queryOptions({
      input: isPhone
        ? { orgSlug, phone: debounced, limit: 20 }
        : { orgSlug, query: debounced, limit: 20 },
    }),
    enabled: debounced.length > 0 && !incomplete,
  });

  return {
    matches: trimmed === debounced ? (results.data?.items ?? []) : [],
    searched: !incomplete && debounced.length > 0 && results.isSuccess && trimmed === debounced,
    error: results.isError ? results.error : null,
  };
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
  const { today } = useOrgDateTime();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<{ name?: string; phone?: string } | null>(null);
  const trimmed = query.trim();
  const { matches, searched, error } = usePatientMatches(orgSlug, query);

  const openRegistration = () => {
    setOpen(false);
    setSeed(callerSeed(trimmed));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Combobox
          items={matches}
          getItemKey={(match) => match.id}
          getItemLabel={(match) => match.name}
          inputValue={query}
          onInputValueChange={setQuery}
          onSelect={(match) => {
            setOpen(false);
            onSelect({ id: match.id, name: match.name, mrn: match.mrn });
          }}
          open={open}
          onOpenChange={setOpen}
          inputRef={searchRef}
          inputClassName="pl-8"
          inputProps={{
            id: "patient-search",
            "aria-label": "Phone or name",
            placeholder: "Phone or name",
            autoComplete: "off",
            autoFocus: true,
            onFocus: () => {
              if (trimmed.length > 0) setOpen(true);
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !searched || matches.length > 0) return;
              event.preventDefault();
              openRegistration();
            },
          }}
          itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-b border-border px-3 py-2 last:border-b-0"
          renderItem={(match) => {
            const age = patientAgeLabel(match.dateOfBirth, match.dobEstimated, today);
            return (
              <>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{match.name}</span>
                  <span className="block truncate text-muted-foreground">
                    {match.mrn} · <span className="font-mono tabular-nums">{match.phone}</span>
                  </span>
                </span>
                <span className="shrink-0 capitalize text-muted-foreground">
                  {age}y · {match.sex}
                </span>
              </>
            );
          }}
          emptyContent={
            searched ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No patient matches “{trimmed}”</EmptyTitle>
                  <EmptyDescription>No existing record uses these details.</EmptyDescription>
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

      {error ? <ErrorNote title="Could not search patients" detail={error.message} /> : null}

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
