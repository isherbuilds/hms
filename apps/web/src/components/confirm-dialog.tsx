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

type Pending = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  run: () => void;
  cancel?: () => void;
};

/** Confirmation gate for the mutations the server audits as destructive. */
export function useConfirm(): [(action: Pending) => void, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancel = () => {
    pending?.cancel?.();
    setPending(null);
  };

  const dialog = (
    <ClientOnly fallback={null}>
      <Dialog open={pending !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              autoFocus
              onClick={() => {
                pending?.run();
                setPending(null);
              }}
            >
              {pending?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );

  return [setPending, dialog];
}
