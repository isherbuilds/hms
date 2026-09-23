import { cn } from "@hms/ui/lib/utils";
import { Building2Icon, UserRoundIcon } from "lucide-react";

const IDENTITY_TONES = [
  "bg-[#dcefed] text-[#245b59] dark:bg-[#193a39] dark:text-[#afe1dc]",
  "bg-[#e5e7f5] text-[#414f7e] dark:bg-[#292f4d] dark:text-[#c7d1f5]",
  "bg-[#f2e5ee] text-[#754963] dark:bg-[#442c3d] dark:text-[#f3c9df]",
  "bg-[#f4ead6] text-[#70551f] dark:bg-[#403721] dark:text-[#eed9a4]",
];

function identityTone(seed: string) {
  let sum = 0;

  for (const character of seed) sum += character.charCodeAt(0);

  return IDENTITY_TONES[sum % IDENTITY_TONES.length];
}

export function Monogram({
  label,
  seed,
  kind,
}: {
  label: string;
  seed: string;
  kind: "patient" | "organization" | "user";
}) {
  const words = label.split(/[\s@._-]+/).filter(Boolean);

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded text-xs font-medium",
        identityTone(seed),
      )}
    >
      {kind === "organization" ? (
        <Building2Icon className="size-3.5" />
      ) : kind === "user" ? (
        <UserRoundIcon className="size-3.5" />
      ) : (
        (words[0]?.[0] ?? "?").concat(words[1]?.[0] ?? "").toUpperCase()
      )}
    </span>
  );
}
