import { env } from "@hms/env/web";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

/* A plain-language summary of the terms of use, not the contract: each
   hospital's written agreement with us governs the rest. */
export const Route = createFileRoute("/terms")({
  head: () => pageHead({ path: "/terms" }),
  component: () => (
    <PublicPage
      title="The terms, in plain words."
      lead="Effective 2 October 2026. These terms cover this website and the use of Edernal Care. A hospital's written agreement with us, where one exists, takes priority over this page."
    >
      <div className={PROSE}>
        <h2>Who may use Edernal Care</h2>
        <p>
          Edernal Care is for hospitals and clinics and their staff. A hospital administrator
          creates each staff account; there is no public sign-up. You may use an account only for
          the hospital that gave it to you, and you must keep your sign-in private.
        </p>

        <h2>The hospital's data</h2>
        <p>
          Patient, staff and billing records belong to the hospital. We process them only to run the
          software for that hospital, as the <Link to="/privacy">privacy notice</Link> describes.
          The hospital is responsible for what its staff enter, for having the right to record it,
          and for the clinical and financial decisions made from it.
        </p>

        <h2>What you agree not to do</h2>
        <ul>
          <li>Look for or open another hospital's data, or try to get around access controls.</li>
          <li>Share an account, or use one that belongs to someone else.</li>
          <li>Probe, overload or disrupt the service, or upload malicious files.</li>
          <li>Use the service for anything unlawful.</li>
        </ul>
        <p>
          We may suspend an account that breaks these rules, and we tell the hospital when we do.
        </p>

        <h2>Not medical advice</h2>
        <p>
          Edernal Care is administrative software. It does not diagnose, treat or advise. Clinical
          judgement stays with the clinician, and the signed prescription stays the clinical record.
        </p>

        <h2>Money and records</h2>
        <p>
          Issued invoices are never overwritten; corrections are credit notes and refunds. Fees,
          where they apply, are set out in the hospital's agreement. Prices on this website are a
          guide until that agreement is signed.
        </p>

        <h2>Availability and changes</h2>
        <p>
          We work to keep the service running, but we do not promise it will never be interrupted.
          Contact us if you have a service problem. We may change the software; the{" "}
          <Link to="/changelog">changelog</Link> records what moved. When these terms change, the
          date above changes with them.
        </p>

        <h2>Leaving</h2>
        <p>
          A hospital may stop at any time. Every report exports to Excel or PDF, so its records
          leave with it. Indian law governs these terms.
        </p>

        <h2>Questions</h2>
        <p>
          Write to <a href={`mailto:${env.VITE_CONTACT_EMAIL}`}>{env.VITE_CONTACT_EMAIL}</a>.
        </p>
      </div>
    </PublicPage>
  ),
});
