import { FileTextIcon, ReceiptIndianRupeeIcon, UsersIcon } from "lucide-react";

import type { Region, ShotName } from "./product-window";

/* The shipped modules that have a page. One list feeds the header's Product
   panel, the landing index grid, the footer's Product column and each feature
   page's sibling row, so the marketing surface and the product's own shelves —
   Care, Finance — never use two words for one thing.

   Only modules with a capture are listed. Files and day-close reports join when
   they have one. */
export const FEATURES: {
  shot: ShotName;
  to: "/opd" | "/patients" | "/billing";
  shelf: "Care" | "Finance";
  label: string;
  blurb: string;
  icon: typeof UsersIcon;
  /* What the landing card shows: a distinctive slice, not the whole screen. */
  thumbnail: Region;
}[] = [
  {
    shot: "opd",
    to: "/opd",
    shelf: "Care",
    label: "Outpatient queue",
    blurb: "Token numbers, waiting times, no-shows.",
    icon: UsersIcon,
    thumbnail: { x: 275, y: 130, w: 760, h: 440 },
  },
  {
    shot: "patients",
    to: "/patients",
    shelf: "Care",
    label: "Patient records",
    blurb: "One MRN, every visit, allergies on top.",
    icon: FileTextIcon,
    thumbnail: { x: 275, y: 130, w: 760, h: 440 },
  },
  {
    shot: "billing",
    to: "/billing",
    shelf: "Finance",
    label: "Billing & collections",
    blurb: "Invoices, refunds, cash and bank transfers.",
    icon: ReceiptIndianRupeeIcon,
    thumbnail: { x: 275, y: 64, w: 760, h: 440 },
  },
];
