import { env } from "@hms/env/web";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_MAILTO } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/security")({
  head: () => pageHead({ path: "/security" }),
  component: () => (
    <PublicPage
      title="How a hospital's data is kept apart and kept safe."
      lead="What the software does today, stated plainly. We list only what is built and running, and we say what is not."
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

        <h2>What we do not claim</h2>
        <p>
          We are not yet ABDM-certified, and we hold no third-party security certification. We will
          say so here the day that changes.
        </p>

        <h2>Report a problem</h2>
        <p>
          If you find a weakness, write to <a href={CONTACT_MAILTO}>{env.VITE_CONTACT_EMAIL}</a>.
          Please do not include patient data. For what we collect and why, read the{" "}
          <Link to="/privacy">privacy notice</Link>.
        </p>
      </div>
    </PublicPage>
  ),
});
