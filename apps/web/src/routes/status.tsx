import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/status")({
  head: () => pageHead({ path: "/status" }),
  component: () => (
    <PublicPage
      title="Service status."
      lead="We do not run a live status monitor yet. This page says how you will hear about problems until we do."
    >
      <div className={PROSE}>
        <h2>If something is wrong</h2>
        <p>
          Tell us on <Link to="/contact">WhatsApp or email</Link>. Say which hospital you are with
          and what you were doing. Do not send patient information.
        </p>

        <h2>How we tell you</h2>
        <ul>
          <li>Planned downtime: we message the hospital's administrator in advance.</li>
          <li>
            An outage or data exposure: we tell the hospital as soon as we know, with what happened
            and what we are doing about it.
          </li>
          <li>
            Fixes and changes to the software are dated in the{" "}
            <Link to="/changelog">changelog</Link>.
          </li>
        </ul>

        <h2>Coming later</h2>
        <p>
          A live status page with incident history will replace this one before we run more than a
          few hospitals. We will say so in the changelog when it does.
        </p>
      </div>
    </PublicPage>
  ),
});
