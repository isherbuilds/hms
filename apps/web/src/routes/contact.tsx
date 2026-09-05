import { env } from "@hms/env/web";
import { Button } from "@hms/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { MailIcon, MessageCircleIcon } from "lucide-react";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_MAILTO, WHATSAPP_URL } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () => pageHead({ path: "/contact" }),
  component: () => (
    <PublicPage
      eyebrow="Contact"
      title="Talk to the people who built it."
      lead="No sales team, no form that goes nowhere. WhatsApp reaches us fastest; email works too."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          className="h-11 normal-case sm:h-9"
          nativeButton={false}
          render={<a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" />}
        >
          <MessageCircleIcon />
          WhatsApp us
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-11 normal-case sm:h-9"
          nativeButton={false}
          render={<a href={CONTACT_MAILTO} />}
        >
          <MailIcon />
          {env.VITE_CONTACT_EMAIL}
        </Button>
      </div>

      <div className={PROSE}>
        <h2>What to send</h2>
        <p>
          Your hospital's name and city, roughly how many outpatients a day, and what you run the
          desk on today. That is enough for us to show you the right screens.
        </p>
        <h2>What not to send</h2>
        <p>
          <strong>Do not send patient information</strong> — no names, MRNs, reports or
          prescriptions — over WhatsApp or email. Neither channel is where patient data belongs, and
          we will not use it if it arrives.
        </p>
        <h2>Existing customers</h2>
        <p>
          Staff accounts are created by your hospital's administrator, not by us. For access
          problems, ask them first; for anything about the software itself, the same channels above
          reach the people who wrote it.
        </p>
      </div>
    </PublicPage>
  ),
});
