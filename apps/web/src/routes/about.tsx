import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => pageHead({ path: "/about" }),
  component: () => (
    <PublicPage
      title="Software for the hospital desk."
      lead="Edernal Care brings patient records, OPD, billing and pharmacy together for hospitals and clinics."
    >
      <div className={PROSE}>
        <h2>From registration to payment</h2>
        <p>
          Register a patient, manage the day's queue, record charges and collect payments. Keep
          visits, invoices and receipts with the patient's record. Manage pharmacy sales and stock
          in the same system.
        </p>
        <h2>Part of Eternal</h2>
        <p>
          Edernal Care is part of <a href="https://eternal.com">Eternal</a>, alongside Eternal
          Campus and Eternal Books. Made in India.
        </p>
        <p>
          <Link to="/contact">Talk to us</Link> about your hospital and see how it works.
        </p>
      </div>
    </PublicPage>
  ),
});
