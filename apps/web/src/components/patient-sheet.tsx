import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { ClientOnly, useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PatientForm, type EditablePatient } from "@/components/patient-form";

const DISCARD = {
  title: "Discard unsaved changes?",
  description: "Unsaved changes will be discarded.",
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
  /** Set to edit an existing record; absent registers a new one. */
  patient?: EditablePatient;
  seed?: { name?: string; phone?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered?: (patient: { id: string; name: string; mrn: string }) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Only the close attempt needs state; the blocker carries its own.
  const [discarding, setDiscarding] = useState(false);

  // One form per open. `open` and the seed both flip while the panel is still on
  // screen, and re-keying then resets the form under the operator mid-exit.
  const [opens, setOpens] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);

  if (wasOpen !== open) {
    setWasOpen(open);

    if (open) setOpens(opens + 1);
  }

  // Read at the moment of closing. Mirroring dirty up here as state cost a render
  // every time the operator typed, to answer a question nothing asks until they
  // try to leave. The form publishes this one attribute and nothing else.
  const isDirty = () => panel.current?.querySelector("form")?.dataset.dirty === "true";

  // `data-dirty` is still set while the panel animates out, so this tells an
  // in-flight close from a real attempt to leave with unsaved work.
  const leaving = useRef(false);

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty() && !leaving.current,
    enableBeforeUnload: () => isDirty() && !leaving.current,
    withResolver: true,
  });

  const closeWithoutBlocking = () => {
    leaving.current = true;
    onOpenChange(false);
  };

  // A new form is mounted whenever the sheet opens again, so it is safe to arm then.
  useEffect(() => {
    if (open) leaving.current = false;
  }, [open]);

  const close = () => {
    if (!isDirty()) return closeWithoutBlocking();
    setDiscarding(true);
  };

  // One dialog serves both: the blocker when armed, the close attempt otherwise.
  const blocked = blocker.status === "blocked";

  return (
    <>
      <ClientOnly fallback={null}>
        <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
          <SheetContent ref={panel}>
            <SheetHeader>
              <SheetTitle>
                {patient ? (
                  <>
                    Edit <span className="font-mono">{patient.mrn}</span>
                  </>
                ) : (
                  "Register patient"
                )}
              </SheetTitle>
            </SheetHeader>
            <PatientForm
              // Every open builds its form from the props it had then, so reopening after a
              // different search cannot keep the previous defaults.
              key={opens}
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
      <ConfirmDialog
        {...DISCARD}
        open={blocked || discarding}
        onConfirm={() => {
          if (blocked) return blocker.proceed?.();
          setDiscarding(false);
          closeWithoutBlocking();
        }}
        onCancel={() => {
          if (blocked) return blocker.reset?.();
          setDiscarding(false);
        }}
      />
    </>
  );
}
