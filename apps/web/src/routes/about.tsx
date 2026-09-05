import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => pageHead({ path: "/about" }),
  component: () => (
    <PublicPage
      eyebrow="About"
      title="Built with one hospital before it is sold to the next."
      lead="HMS is desk software for small and mid-sized Indian hospitals: the outpatient queue, the patient record and the money, in one system."
    >
      <div className={PROSE}>
        <h2>How it started</h2>
        <p>
          HMS began in August 2026 alongside one hospital's front desk, which was running on an
          older hospital-management system it had outgrown. Rather than replace it all at once, we
          built the smallest thing that could stand in for a morning shift — one list for the day,
          one record per patient, one immutable bill — and put it in front of the people who would
          use it.
        </p>
        <p>
          Everything since has shipped the same way — a vertical slice, run at a real desk,
          corrected, then kept. The <Link to="/changelog">changelog</Link> is that history.
        </p>

        <h2>What we believe</h2>
        <h3>One dataset per hospital, and nothing shared.</h3>
        <p>
          Every record carries exactly one organization, and every request proves membership before
          it reads or writes anything — including the audit log and uploaded files. There is no
          cross-tenant path to switch off, because there is no cross-tenant path.
        </p>
        <h3>Money is never overwritten.</h3>
        <p>
          An issued invoice is immutable. Discounts after issue are credit notes; money returned is
          a refund; every payment produces its own receipt. The billing ledger is a double-entry
          projection of those documents, so an accountant gets source records, not a summary they
          have to trust.
        </p>
        <h3>Only states someone can observe.</h3>
        <p>
          An appointment is booked, checked in, cancelled or a no-show. We removed the states a
          receptionist cannot actually see, because a status nobody can verify is a status that is
          always wrong.
        </p>
        <h3>Doctors keep writing on paper.</h3>
        <p>
          HMS stores the signed prescription as a private scan against the visit. It does not
          present an unreviewed digital or AI reconstruction as the clinical record. When a hospital
          asks for digital authorship, it will ship with consent, provenance and a clinician's
          review in the loop — not before.
        </p>
        <h3>Nothing is claimed before it is held.</h3>
        <p>
          We are not yet ABDM-certified and the footer says so. Inpatient, emergency, pharmacy and
          lab have no page here because they do not run yet. A module appears on this site the day a
          hospital can use it.
        </p>

        <h2>Where it is going</h2>
        <p>
          The outpatient and billing path is live. Next is the pilot's own list: printer validation,
          the day-close runbook and role splits for reception, cashier and accountant. After that,
          modules open in the order hospitals actually need them and only when one has a named owner
          asking — inpatient admissions, emergency, then the payer domain that insurance and
          corporate credit deserve.
        </p>

        <h2>Who we are</h2>
        <p>
          A small team, not yet incorporated, building this alongside the hospital that runs it.
          When the company exists, its legal name, registration and registered office will appear
          here and in the footer, as the law requires. Until then, you can{" "}
          <Link to="/contact">reach us directly</Link>.
        </p>
      </div>
    </PublicPage>
  ),
});
