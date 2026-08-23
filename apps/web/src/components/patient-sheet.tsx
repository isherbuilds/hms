import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { ClientOnly, useBlocker } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { PatientForm, type EditablePatient } from "@/components/patient-form";

/**
 * A patient record as a panel over whatever the operator was looking at, rather
 * than a page away from it: they keep their place, and the list or the record
 * behind refreshes under the sheet as soon as it saves.
 *
 * One sheet serves both jobs. The sheet owns only opening and closing;
 * `PatientForm` owns the record, and switches between registering and
 * correcting based on whether it was handed one. It needs no styling of its
 * own: the floating panel is `SheetContent`'s default.
 */

const DISCARD = {
  title: "Discard unsaved changes?",
  description: "The patient record has changes that have not been saved.",
  confirmLabel: "Discard changes",
};

export function PatientSheet({
  orgSlug,
  patient,
  seed,
  open,
  onOpenChange,
  onRegistered,
}: {
  orgSlug: string;
  /** Omit to register a new patient; pass a record to correct an existing one. */
  patient?: EditablePatient;
  /** Pre-fills a new record from what the operator already typed elsewhere. */
  seed?: { name?: string; phone?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hands the new record back instead of routing to it. */
  onRegistered?: (patient: { id: string; name: string; mrn: string }) => void;
}) {
  const [confirm, confirmation] = useConfirm();
  const panel = useRef<HTMLDivElement>(null);

  /**
   * The form marks itself dirty and busy on its own element, and this reads it
   * at the moment of closing. Mirroring those two flags up here as state cost
   * the sheet a render every time the operator dirtied a field, to answer a
   * question nothing asks until they try to leave.
   */
  const flags = () => panel.current?.querySelector("form")?.dataset ?? {};
  const isDirty = () => flags().dirty === "true";

  // `data-dirty` is still set while the panel animates out, so this is what
  // tells an in-flight close from a real attempt to leave with unsaved work.
  const leaving = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty() && !leaving.current,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });

  const closeWithoutBlocking = () => {
    leaving.current = true;
    onOpenChange(false);
    window.setTimeout(() => {
      leaving.current = false;
    }, 0);
  };

  /** Closing by any route — the X, Escape, the scrim, the form's Cancel. */
  const close = () => {
    if (flags().pending === "true") return;
    if (!isDirty()) return closeWithoutBlocking();
    confirm({ ...DISCARD, run: closeWithoutBlocking });
  };

  // Navigating away from under the sheet asks the same question.
  useEffect(() => {
    if (blocker.status !== "blocked") return;
    confirm({ ...DISCARD, run: blocker.proceed, cancel: blocker.reset });
  }, [blocker, confirm]);

  return (
    <>
      <ClientOnly fallback={null}>
        <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
          <SheetContent ref={panel}>
            <SheetHeader className="border-b border-border">
              <SheetTitle>{patient ? "Edit patient" : "Register patient"}</SheetTitle>
            </SheetHeader>
            <PatientForm
              // The seed is part of the identity: reopening the sheet after a
              // different search must not keep the previous defaults.
              key={`${patient?.id ?? "new"}:${seed?.name ?? ""}:${seed?.phone ?? ""}:${open}`}
              orgSlug={orgSlug}
              patient={patient}
              seed={seed}
              onCancel={close}
              onSaved={closeWithoutBlocking}
              onRegistered={onRegistered}
            />
          </SheetContent>
        </Sheet>
      </ClientOnly>
      {confirmation}
    </>
  );
}
