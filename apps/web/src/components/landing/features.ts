import { FileTextIcon, ReceiptIndianRupeeIcon, UsersIcon } from "lucide-react";

import type { ShotName } from "./product-window";

/* The shipped modules that have a page; each feature page lists the others.
   Only modules with a capture are listed. Files and day-close reports join when
   they have one. */
export const FEATURES: {
  shot: ShotName;
  to: "/opd" | "/patients" | "/billing";
  label: string;
  blurb: string;
  icon: typeof UsersIcon;
}[] = [
  {
    shot: "opd",
    to: "/opd",
    label: "Outpatient queue",
    blurb: "Token numbers, waiting times, no-shows.",
    icon: UsersIcon,
  },
  {
    shot: "patients",
    to: "/patients",
    label: "Patient records",
    blurb: "One MRN, every visit, allergies on top.",
    icon: FileTextIcon,
  },
  {
    shot: "billing",
    to: "/billing",
    label: "Billing & collections",
    blurb: "Invoices, refunds, cash and bank transfers.",
    icon: ReceiptIndianRupeeIcon,
  },
];
