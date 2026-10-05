import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_RESPONSE } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/security")({
  head: () => pageHead({ path: "/security" }),
  component: () => (
    <PublicPage
      title="How a hospital's data is kept apart and kept safe."
      lead="Draft reviewed 4 October 2026; publication awaits counsel approval. Implemented software controls and operational requirements are distinguished below."
    >
      <div className={PROSE}>
        <h2>One hospital, one dataset</h2>
        <p>
          Every record belongs to exactly one hospital, and every request proves membership before
          it reads or writes. That includes the audit log and uploaded files. No hospital can see
          another's data.
        </p>

        <h2>Who can do what</h2>
        <p>
          Each staff member has one or more roles, and each role lists its permissions. The server
          checks them on every request; hiding a button is never the control. Denied attempts are
          written to the audit log.
        </p>

        <h2>Accounts</h2>
        <ul>
          <li>
            Public sign-up is closed. Staff join through an invitation or an operator-created
            account.
          </li>
          <li>Passwords are hashed. We cannot read them.</li>
          <li>Only the hospital's own members can open its data.</li>
        </ul>

        <h2>Audit trail</h2>
        <p>
          Sensitive actions — deletions, financial corrections, role denials — are logged with who,
          what and when. The log belongs to the hospital, and staff cannot edit it.
        </p>

        <h2>Files</h2>
        <p>
          Prescription scans and other uploads sit in a private bucket that is never publicly
          readable. Each time an authorised member opens one, the software issues a short-lived
          link.
        </p>

        <h2>Money records</h2>
        <p>
          Issued invoices are immutable. Corrections are separate documents, so the original always
          stays on record.
        </p>

        <h2>Incident response and operational duties</h2>
        <p>
          Our Designated Operations Operator leads incident response; the founder is the alternate.
          The affected hospital is informed immediately. Reportable cyber incidents are reported to
          CERT-In within six hours of noticing or being informed. The deployment must keep ICT logs
          securely in India for at least 180 days, synchronise system clocks to an approved or
          traceable time source, and register the operator's CERT-In point of contact. These are
          operator duties, not automated notifications or proof of a configured host.
        </p>
        <p>
          DPDP breach policy requires affected-person and Board initial notices without delay and
          detailed Board information within 72 hours unless a written extension is granted. The
          hospital is Data Fiduciary for its records; we assist it as processor. The substantive
          DPDP duties are scheduled for 13 May 2027; CERT-In reporting already applies. See the{" "}
          <Link to="/privacy">privacy notice</Link> for rights and retention.
        </p>

        <h2>What we do not claim</h2>
        <p>
          We are not yet ABDM-certified and hold no third-party security certification. Application
          access controls alone do not establish compliance with IT Act section 43A or SPDI Rule 8.
          Production backup/restore, documented organisational and physical safeguards, logging,
          contact registration and independent review require operator evidence.
        </p>

        <h2>Report a problem</h2>
        <p>
          If you find a weakness, write to <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with the
          subject “Security report”. Please do not include patient data or exploit another
          hospital's records. {CONTACT_RESPONSE} The ordinary inbox window does not postpone
          statutory incident reporting. For privacy grievances, read the{" "}
          <Link to="/privacy">privacy notice</Link>.
        </p>
      </div>
    </PublicPage>
  ),
});
