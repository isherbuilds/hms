import { Button } from "@hms/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { MailIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_RESPONSE, PHONE } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () => pageHead({ path: "/contact" }),
  component: () => (
    <PublicPage
      title="Talk to the people who built it."
      lead={`Email ${CONTACT_EMAIL} to book a demo, ask for help or raise a grievance.`}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          className="h-11 normal-case sm:h-9"
          nativeButton={false}
          render={<a href={CONTACT_MAILTO} />}
        >
          <MailIcon />
          {CONTACT_EMAIL}
        </Button>
        {PHONE ? (
          <>
            <Button
              size="lg"
              variant="outline"
              className="h-11 normal-case sm:h-9"
              nativeButton={false}
              render={<a href={PHONE.whatsapp} target="_blank" rel="noopener noreferrer" />}
            >
              <MessageCircleIcon />
              WhatsApp us
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 normal-case sm:h-9"
              nativeButton={false}
              render={<a href={PHONE.tel} />}
            >
              <PhoneIcon />
              {PHONE.display}
            </Button>
          </>
        ) : null}
      </div>

      <div className={PROSE}>
        <h2>Who replies</h2>
        <p>{CONTACT_RESPONSE} This is not a 24-hour emergency or clinical-support service.</p>
        <h2>For a demo</h2>
        <p>Tell us your hospital's name, city and what you need help managing.</p>
        <h2>For support</h2>
        <p>
          Tell us what happened. For staff access, contact your hospital administrator. Please do
          not send patient information over WhatsApp or email.
        </p>
      </div>
    </PublicPage>
  ),
});
