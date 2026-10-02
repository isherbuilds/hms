import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/customers")({
  head: () => pageHead({ path: "/customers" }),
  component: () => (
    <PublicPage
      title="One hospital so far, and we say so."
      lead="Edernal Care is in use at the hospital it was built with. We will not show logos or quotes we do not have."
    >
      <div className={PROSE}>
        <h2>Who uses it today</h2>
        <p>
          A single hospital's front desk runs its outpatient queue, patient records and billing on
          Edernal Care. Every change in the software came from that desk first. The{" "}
          <Link to="/about">about page</Link> tells the story, and the{" "}
          <Link to="/changelog">changelog</Link> shows the work, dated.
        </p>

        <h2>Who it is for next</h2>
        <p>
          Small and mid-sized Indian hospitals and clinics that run the desk on paper, spreadsheets
          or an older system they have outgrown. We take on a few at a time, so each one gets the
          same care the first did.
        </p>

        <h2>Be the next one</h2>
        <p>
          <Link to="/contact">Tell us</Link> your hospital's name, city, roughly how many
          outpatients you see a day, and what the desk runs on now. We will show you the screens
          that match.
        </p>
      </div>
    </PublicPage>
  ),
});
