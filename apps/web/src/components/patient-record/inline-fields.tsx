import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Textarea } from "@hms/ui/components/textarea";
import { cn } from "@hms/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PencilIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc";
import { errorDataCode } from "@/lib/orpc-error";

/**
 * The patient record edits where it is read. There is no edit mode and no
 * panel: a field is a button until it is clicked, then a control, and Enter
 * writes it.
 *
 * The procedure takes the whole record, not a patch. Every commit sends the
 * current row with one value replaced and its latest compare-and-swap token.
 */
export type EditablePatientRecord = {
  id: string;
  mrn: string;
  updatedAt: string;
  name: string;
  phone: string;
  sex: "male" | "female" | "other" | "unknown";
  dateOfBirth: string;
  dobEstimated: boolean;
  address: string;
  email: string | null;
  bloodGroup: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
  allergies: string | null;
  medicalHistory: string | null;
  uid: string | null;
};

type FieldKey = Exclude<keyof EditablePatientRecord, "id" | "mrn" | "updatedAt" | "dobEstimated">;
type FieldKind = "text" | "date" | "sex" | "blood" | "textarea";

/** Every field the update procedure requires, with one value replaced. */
function nextRecord(
  record: EditablePatientRecord,
  field: FieldKey,
  raw: string,
): EditablePatientRecord | { error: string } {
  const trimmed = raw.trim();

  switch (field) {
    case "name":
      if (!trimmed) return { error: "A patient needs a name." };
      return { ...record, name: trimmed };
    case "phone":
      if (trimmed.length < 4) return { error: "Enter at least 4 characters." };
      return { ...record, phone: trimmed };
    case "sex":
      return { ...record, sex: trimmed as EditablePatientRecord["sex"] };
    case "bloodGroup":
      return { ...record, bloodGroup: (trimmed || null) as EditablePatientRecord["bloodGroup"] };
    case "dateOfBirth":
      if (!trimmed) return { error: "Enter a date of birth." };
      return { ...record, dateOfBirth: trimmed, dobEstimated: false };
    case "email":
      return { ...record, email: trimmed || null };
    case "uid":
      return { ...record, uid: trimmed || null };
    case "address":
      return { ...record, address: trimmed };
    case "allergies":
      return { ...record, allergies: trimmed || null };
    case "medicalHistory":
      return { ...record, medicalHistory: trimmed || null };
  }
}

export function usePatientFieldSave(orgSlug: string, record: EditablePatientRecord) {
  const queryClient = useQueryClient();
  const [savedField, setSavedField] = useState<FieldKey | null>(null);
  // Which field the in-flight write belongs to. A ref, not state: the mutation
  // callbacks read it after the fact, and re-rendering on every keystroke-sized
  // write would buy nothing.
  const inFlight = useRef<FieldKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const update = useMutation(
    orpc.patient.update.mutationOptions({
      onSuccess: async () => {
        const field = inFlight.current;
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.patient.get.key({ input: { orgSlug, patientId: record.id } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.patient.search.key({ input: { orgSlug } }),
          }),
        ]);
        setSavedField(field);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setSavedField(null), 1400);
      },
      onError: (error) => {
        if (errorDataCode(error) === "STALE_RECORD") {
          toast.error(error.message, {
            action: {
              label: "Refresh",
              onClick: async () => {
                await queryClient.invalidateQueries({
                  queryKey: orpc.patient.get.key({
                    input: { orgSlug, patientId: record.id },
                  }),
                });
              },
            },
          });
          return;
        }
        toast.error(
          errorDataCode(error) === "UID_TAKEN"
            ? "A patient with this UID already exists."
            : error.message,
        );
      },
    }),
  );

  return {
    savedField,
    pending: update.isPending,
    save(field: FieldKey, raw: string) {
      if (update.isPending) return;
      const next = nextRecord(record, field, raw);
      if ("error" in next) {
        toast.error(next.error);
        return;
      }
      const { id: _id, mrn: _mrn, updatedAt, ...fields } = next;
      inFlight.current = field;
      update.mutate({ orgSlug, patientId: record.id, updatedAt, ...fields });
    },
  };
}

function Editor({
  kind,
  value,
  onCommit,
  onCancel,
}: {
  kind: FieldKind;
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);

  // Enter commits, Escape reverts. A textarea keeps Enter for newlines, so it
  // commits on blur or Cmd/Ctrl+Enter instead.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Enter") return;
    if (kind === "textarea" && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    onCommit(draft);
  };

  if (kind === "sex" || kind === "blood") {
    const options =
      kind === "sex"
        ? ["male", "female", "other", "unknown"]
        : ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    return (
      <NativeSelect
        autoFocus
        value={draft}
        onKeyDown={onKeyDown}
        onBlur={() => onCommit(draft)}
        onChange={(event) => {
          setDraft(event.target.value);
          onCommit(event.target.value);
        }}
      >
        {kind === "blood" ? <option value="">Not recorded</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
    );
  }

  if (kind === "textarea") {
    return (
      <Textarea
        autoFocus
        rows={3}
        value={draft}
        onKeyDown={onKeyDown}
        onBlur={() => onCommit(draft)}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }

  return (
    <Input
      autoFocus
      type={kind === "date" ? "date" : "text"}
      value={draft}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(draft)}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

function SavedFlag() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-clinical-clear">
      <CheckIcon className="size-3.5" />
      Saved
    </span>
  );
}

/** One editable line of the record. */
export function InlineRow({
  label,
  field,
  kind,
  value,
  display,
  saver,
  compact = false,
}: {
  label: string;
  field: FieldKey;
  kind: FieldKind;
  value: string;
  display?: ReactNode;
  saver: ReturnType<typeof usePatientFieldSave>;
  /** Narrower label column, for the two-up layout. */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const pending = saver.pending;

  return (
    <div
      className={cn(
        "grid grid-cols-1 items-center gap-1 border-b border-border/60 py-1.5 last:border-b-0 sm:gap-3",
        compact ? "sm:grid-cols-[7rem_minmax(0,1fr)]" : "sm:grid-cols-[10rem_minmax(0,1fr)]",
      )}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <Editor
            kind={kind}
            value={value}
            onCancel={() => setEditing(false)}
            onCommit={(next) => {
              setEditing(false);
              if (next !== value) saver.save(field, next);
            }}
          />
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
            className={cn(
              "group/row -ml-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
              "disabled:opacity-60",
              !value && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{display ?? (value || "Not recorded")}</span>
            {saver.savedField === field ? (
              <SavedFlag />
            ) : (
              <PencilIcon className="size-3.5 shrink-0 text-muted-foreground opacity-50 transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/row:opacity-100" />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * A clinical field with a hue: allergies in alert red, history in note amber, a
 * clear allergy record in green. The colour is the claim — see `docs/design.md`
 * §5 for why these four tokens are the only chromatic exception.
 */
export function InlineClinicalBlock({
  title,
  field,
  tone,
  value,
  placeholder,
  saver,
}: {
  title: string;
  field: FieldKey;
  tone: "alert" | "note" | "clear";
  value: string;
  placeholder: string;
  saver: ReturnType<typeof usePatientFieldSave>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3",
        tone === "alert" && "border-clinical-alert-border bg-clinical-alert-surface",
        tone === "note" && "border-clinical-note-border bg-clinical-note-surface",
        tone === "clear" && "border-clinical-clear-border bg-clinical-clear-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        {saver.savedField === field ? <SavedFlag /> : null}
      </div>
      {editing ? (
        <Editor
          kind="textarea"
          value={value}
          onCancel={() => setEditing(false)}
          onCommit={(next) => {
            setEditing(false);
            if (next !== value) saver.save(field, next);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={saver.pending}
          onClick={() => setEditing(true)}
          className={cn(
            "-mx-1 rounded-md px-1 py-0.5 text-left transition-colors disabled:opacity-60",
            "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-foreground/5",
            !value && "text-muted-foreground",
          )}
        >
          {value || placeholder}
        </button>
      )}
    </section>
  );
}
