import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/opd")({
  head: () => pageHead({ path: "/opd" }),
  component: () => (
    <FeaturePage
      shot="opd"
      eyebrow="Outpatient queue"
      title="See the whole morning at once"
      lead="Who is waiting, who is in a room, who never turned up."
      windowTitle="Outpatient · Mercy General"
      captureAlt="The outpatient day list: token, patient, time, practitioner, status and balance for every appointment on the day"
      crops={[
        {
          region: { x: 272, y: 160, w: 740, h: 430 },
          claim: "A token when they arrive, a status while they wait.",
          body: "Reception checks a patient in with one click; the token number and the status change on every screen that shows the day.",
        },
        {
          region: { x: 272, y: 70, w: 760, h: 430 },
          claim: "Every practitioner's morning, on one list.",
          body: "Search by name, MRN, phone or token, and switch between the open queue and the whole day.",
        },
        {
          region: { x: 340, y: 440, w: 1100, h: 330 },
          claim: "A balance that follows the patient.",
          body: "Money still owed from the visit shows on the queue itself, so nobody leaves the building unbilled.",
        },
      ]}
    />
  ),
});
