import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/patients")({
  head: () => pageHead({ path: "/patients" }),
  component: () => (
    <FeaturePage
      shot="patients"
      eyebrow="Patient records"
      title="Every patient, one keystroke away"
      lead="Search by name, MRN or phone. Allergies travel with the record."
      windowTitle="Patients · Mercy General"
      captureAlt="The patient registry: MRN, name, phone, sex, age and registration date for every patient"
      crops={[
        {
          region: { x: 272, y: 60, w: 720, h: 260 },
          claim: "One search box. Name, MRN or phone.",
          body: "The MRN is issued once and never reused, so the same number finds the same patient at every desk.",
        },
        {
          region: { x: 272, y: 160, w: 1144, h: 520 },
          claim: "The registry, as a list you can read.",
          body: "MRN, name, phone, sex, age and the date they were registered, newest first.",
        },
        {
          region: { x: 700, y: 0, w: 740, h: 400 },
          claim: "Register in the same place you search.",
          body: "A new patient is registered from the registry itself, and their record opens with allergies on top.",
        },
      ]}
    />
  ),
});
