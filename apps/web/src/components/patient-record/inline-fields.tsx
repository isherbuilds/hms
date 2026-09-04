import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Textarea } from "@hms/ui/components/textarea";
import { cn } from "@hms/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PencilIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { invalidatePatientState } from "@/lib/domain-invalidation";
import { patientFieldSchema, type PatientFields } from "@/lib/form-schema";
import { orpc } from "@/lib/orpc";
import { errorMessage, errorReason } from "@/lib/orpc-error";

// The procedure takes the whole record, not a patch: every commit sends the current
// row with one value replaced and its latest compare-and-swap token.
export type EditablePatientRecord = PatientFields & {
  id: string;
  mrn: string;
  updatedAt: string;
};

type FieldKey = Exclude<keyof PatientFields, "dobEstimated">;
type FieldKind = "text" | "date" | "sex" | "blood" | "textarea";

export function usePatientFieldSave(orgSlug: string, record: EditablePatientRecord) {
  const queryClient = useQueryClient();
  // Wrapped in an object so saving the same field twice is a new value and the tick
  // below restarts.
  const [savedToken, setSavedToken] = useState<{ field: FieldKey } | null>(null);

  useEffect(() => {
    if (!savedToken) return;
    const timer = setTimeout(() => setSavedToken(null), 1400);
    return () => clearTimeout(timer);
  }, [savedToken]);

  const update = useMutation(
    orpc.patient.update.mutationOptions({
      onSuccess: async () => {
        await invalidatePatientState(queryClient, orgSlug, record.id);
      },
      onError: (error) => {
        if (errorReason(error) === "stale_record") {
          toast.error(error.message, {
            action: {
              label: "Refresh",
              onClick: () => void invalidatePatientState(queryClient, orgSlug, record.id),
            },
          });
          return;
        }
        toast.error(errorMessage(error, "Could not save that change"));
      },
    }),
  );

  // Every field holds `save`, so its identity alone decides whether one edit wakes
  // one field or all ten. Record and pending flag travel by ref, not in the closure.
  const latest = useRef({ record, pending: update.isPending });
  useEffect(() => {
    latest.current = { record, pending: update.isPending };
  });

  const mutate = update.mutate;
  const save = useCallback(
    (field: FieldKey, raw: string) => {
      const { record, pending } = latest.current;
      if (pending) return;
      const parsed = patientFieldSchema.shape[field].safeParse(raw);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Enter a valid value.");
        return;
      }
      const next = {
        ...record,
        [field]: parsed.data,
        ...(field === "dateOfBirth" ? { dobEstimated: false } : {}),
      };
      const { id: _id, mrn: _mrn, updatedAt, ...fields } = next;
      mutate(
        { orgSlug, patientId: record.id, updatedAt, ...fields },
        { onSuccess: () => setSavedToken({ field }) },
      );
    },
    [mutate, orgSlug],
  );

  return { savedField: savedToken?.field ?? null, pending: update.isPending, save };
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
  // Callers key this on `value`, so a record that changed underneath reseeds the
  // draft instead of writing a stale one back on blur.
  const [draft, setDraft] = useState(value);

  // A textarea keeps Enter for newlines, so it commits on blur or Cmd/Ctrl+Enter.
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

// Told what happened to its own field rather than handed the saver: one page-wide
// object as a prop re-rendered all ten fields on every step of one save.
export function InlineRow({
  label,
  field,
  kind,
  value,
  display,
  saved,
  pending,
  onSave,
  compact = false,
}: {
  label: string;
  field: FieldKey;
  kind: FieldKind;
  value: string;
  display?: ReactNode;
  saved: boolean;
  pending: boolean;
  onSave: (field: FieldKey, raw: string) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);

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
            key={value}
            kind={kind}
            value={value}
            onCancel={() => setEditing(false)}
            onCommit={(next) => {
              setEditing(false);
              if (next !== value) onSave(field, next);
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
            {saved ? (
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

// The colour is the claim — see docs/design.md §5 for why these four tokens are
// the only chromatic exception.
export function InlineClinicalBlock({
  title,
  field,
  tone,
  value,
  placeholder,
  saved,
  pending,
  onSave,
}: {
  title: string;
  field: FieldKey;
  tone: "alert" | "note" | "clear";
  value: string;
  placeholder: string;
  saved: boolean;
  pending: boolean;
  onSave: (field: FieldKey, raw: string) => void;
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
        {saved ? <SavedFlag /> : null}
      </div>
      {editing ? (
        <Editor
          key={value}
          kind="textarea"
          value={value}
          onCancel={() => setEditing(false)}
          onCommit={(next) => {
            setEditing(false);
            if (next !== value) onSave(field, next);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={pending}
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
