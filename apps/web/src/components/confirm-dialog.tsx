import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { ClientOnly } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

type Question = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
};

// Reach for this first; `useConfirm` only adds state for callers that have none
// of their own.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: Question & { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" autoFocus onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

type Pending = Question & { run: () => void; cancel?: () => void };

export function useConfirm(): [(action: Pending) => void, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel ?? ""}
      onConfirm={() => {
        pending?.run();
        close();
      }}
      onCancel={() => {
        pending?.cancel?.();
        close();
      }}
    />
  );

  return [setPending, dialog];
}
