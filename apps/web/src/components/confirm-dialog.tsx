import { Button } from "@better-stack/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-stack/ui/components/dialog";
import { useState, type ReactNode } from "react";

type Pending = { title: string; description: ReactNode; confirmLabel: string; run: () => void };

/** Confirmation gate for the mutations the server audits as destructive. */
export function useConfirm(): [(action: Pending) => void, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPending(null)}>
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
  );

  return [setPending, dialog];
}
