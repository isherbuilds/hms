import { Button } from "@hms/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@hms/ui/components/empty";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorNote } from "@/components/page";
import { PatientSheet } from "@/components/patient-sheet";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeYears } from "@/lib/patient-age";

/**
 * A walk-in desk has a person and a phone number, not a record id. So one field
 * searches, warns about duplicates, and offers registration, because at a front
 * desk those are the same question — "have we seen you before?".
 *
 * Shared by check-in and the OPD intake page. Registering a patient opens the
 * patient sheet over a page rather than stacking a second modal.
 */
export type SelectedPatient = { id: string; name: string; mrn: string };

/** Digits, spaces, `+` and `-` only — what a phone number looks like at a desk. */
const LOOKS_LIKE_PHONE = /^[\d+\s-]+$/;

/**
 * Debounced patient search behind one free-text box. Digits mean a phone;
 * anything else is a name. Phone is an exact-prefix column match, so routing
 * it correctly is what makes one field do both jobs.
 */
function usePatientMatches(orgSlug: string, raw: string) {
  const trimmed = raw.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const isPhone = /^[\d+\s-]+$/.test(debounced) && debounced.replace(/\D/g, "").length >= 4;

  const results = useQuery({
    ...orpc.patient.search.queryOptions({
      input: isPhone
        ? { orgSlug, phone: debounced, limit: 20 }
        : { orgSlug, query: debounced, limit: 20 },
    }),
    enabled: debounced.length >= 2,
  });

  return {
    isPhone,
    matches: trimmed === debounced ? (results.data?.items ?? []) : [],
    searched: debounced.length >= 2 && results.isSuccess && trimmed === debounced,
    error: results.isError ? results.error : null,
  };
}

/** The shared desk search-and-register interaction used by check-in and intake. */
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
  /**
   * Held rather than derived, so the sheet keeps the values the desk had typed
   * at the moment it opened even if the box is edited behind it.
   */
  const [seed, setSeed] = useState<{ name?: string; phone?: string } | null>(null);
  const trimmed = query.trim();
  const { matches, searched, error } = usePatientMatches(orgSlug, query);

  // Digits are a phone, anything else is a name — the same split the search box
  // already makes, so whatever was typed lands in the right field.
  const openRegistration = () =>
    setSeed(LOOKS_LIKE_PHONE.test(trimmed) ? { phone: trimmed } : { name: trimmed });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          aria-label="Phone or name"
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Phone or name"
          autoFocus
          autoComplete="off"
        />
      </div>

      {error ? (
        <ErrorNote title="Could not search patients" detail={error.message} />
      ) : matches.length > 0 ? (
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md ring-1 ring-border">
          {matches.map((match) => {
            const age = patientAgeYears(match.dateOfBirth, match.ageYears, today);
            return (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ id: match.id, name: match.name, mrn: match.mrn })}
                  className="flex w-full items-baseline gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
                >
                  <span className="font-medium">{match.name}</span>
                  <span className="text-muted-foreground">
                    {match.mrn} · {match.phone}
                  </span>
                  <span className="ml-auto shrink-0 capitalize text-muted-foreground">
                    {age === null ? "Age —" : `${age}y`} · {match.sex}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : searched ? (
        <Empty className="rounded-md ring-1 ring-border">
          <EmptyHeader>
            <EmptyTitle>No patient matches “{trimmed}”</EmptyTitle>
            <EmptyDescription>
              {LOOKS_LIKE_PHONE.test(trimmed)
                ? "Register them and this number is filled in for you."
                : "Register them and this name is filled in for you."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openRegistration}>
              Register new patient
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {searched && matches.length === 0 ? null : (
        <Button type="button" variant="outline" className="self-start" onClick={openRegistration}>
          Register new patient
        </Button>
      )}

      {/* The real registration form, not a second copy of it: address, blood
          group and history are all here, and the walk-in is still underneath. */}
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
