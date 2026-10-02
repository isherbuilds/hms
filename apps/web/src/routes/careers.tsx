import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/careers")({
  head: () => pageHead({ path: "/careers" }),
  component: () => (
    <PublicPage
      title="No open roles right now."
      lead="We are a small team building hospital software alongside the hospital that uses it. We hire slowly and on purpose."
    >
      <div className={PROSE}>
        <h2>How we work</h2>
        <p>
          We ship in small vertical slices, run them at a real front desk, and fix what we learn
          there. People here own a feature from the screen down to the database. Read the{" "}
          <Link to="/about">about page</Link> and the <Link to="/changelog">changelog</Link> to see
          the pace.
        </p>

        <h2>Who we will want</h2>
        <ul>
          <li>
            Engineers who like plain code and care that a receptionist can use what they build.
          </li>
          <li>People who have worked in a hospital front office, billing desk or pharmacy.</li>
          <li>Support and onboarding staff who can sit with a hospital team and make it work.</li>
        </ul>

        <h2>Write to us anyway</h2>
        <p>
          <Link to="/contact">Send a note</Link> with what you have built or run, and what you would
          like to work on. We read everything and keep it for when a role opens.
        </p>
      </div>
    </PublicPage>
  ),
});
