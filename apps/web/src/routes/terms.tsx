import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_RESPONSE } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

/* A plain-language summary of the terms of use, not the contract: each
   hospital's written agreement with us governs the rest. */
export const Route = createFileRoute("/terms")({
  head: () => pageHead({ path: "/terms" }),
  component: () => (
    <PublicPage
      title="The terms, in plain words."
      lead="Draft reviewed 4 October 2026; publication awaits counsel approval. These terms cover the website and Edernal Care; a hospital's written agreement governs its contracted service, subject to mandatory law."
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
          Issued invoices are never overwritten; corrections are credit notes and refunds. Access is
          invite-only and this site does not take online orders or payments. Fees, taxes, delivery,
          support, cancellation and refunds for the software are agreed in writing before purchase.
          No price or refund entitlement is invented by this page.
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
          A hospital may request its records and end service under its written agreement. Report
          exports are not a complete database exit package; arrange the full export and applicable
          retained-record schedule with us. Indian law governs these terms. Nothing here or in a
          hospital agreement excludes mandatory consumer remedies or statutory data-protection
          rights.
        </p>

        <h2>Questions and grievances</h2>
        <p>
          The founder is the designated public grievance contact. Write to{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with the subject “Service grievance” and your
          hospital name or enquiry reference, without patient information. {CONTACT_RESPONSE} For
          privacy requests, use the <Link to="/privacy">privacy notice</Link>.
        </p>
      </div>
    </PublicPage>
  ),
});
