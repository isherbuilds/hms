import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { z } from "zod";

import { GuidedCommit } from "@/prototypes/opd-desk/guided-commit";
import { OnePassLedger } from "@/prototypes/opd-desk/one-pass-ledger";
import { PrototypePicker } from "@/prototypes/opd-desk/prototype-picker";
import { SplitCheckout } from "@/prototypes/opd-desk/split-checkout";

const VARIANTS = [OnePassLedger, SplitCheckout, GuidedCommit] as const;
const NAMES = ["One-pass ledger", "Split checkout", "Guided commit"] as const;

export const Route = createFileRoute("/prototype-opd-desk")({
  head: () => ({ meta: [{ title: "OPD desk prototype · HMS" }] }),
  validateSearch: z.object({ v: z.coerce.number().int().min(1).max(VARIANTS.length).catch(1) }),
  component: OpdDeskPrototypeRoute,
});

function OpdDeskPrototypeRoute() {
  const { v } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [replay, setReplay] = useState(0);
  const index = v - 1;
  const Variant = VARIANTS[index] ?? VARIANTS[0];

  const change = useCallback(
    (next: number) => {
      void navigate({ search: { v: next + 1 }, replace: true });
      setReplay((current) => current + 1);
    },
    [navigate],
  );
  const replayCurrent = useCallback(() => setReplay((current) => current + 1), []);

  return (
    <>
      <style>{`@keyframes proto-enter {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .proto-enter { animation: proto-enter 160ms ease-out both; }`}</style>
      <Variant key={`${index}:${replay}`} />
      <PrototypePicker names={NAMES} current={index} onChange={change} onReplay={replayCurrent} />
    </>
  );
}
