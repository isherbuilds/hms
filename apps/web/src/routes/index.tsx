import { createFileRoute } from "@tanstack/react-router";

import { LandingCapabilities } from "@/components/landing/capabilities";
import { LandingClosing } from "@/components/landing/closing";
import { LandingFaq } from "@/components/landing/faq";
import { LandingHero } from "@/components/landing/hero";
import { LandingNav } from "@/components/landing/nav";
import { LandingOnTheFloor } from "@/components/landing/on-the-floor";
import { LandingTestimonials } from "@/components/landing/testimonials";
import { redirectSignedInHome } from "@/lib/home";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/")({
  // A signed-in visitor never sees the marketing page; the redirect happens on the
  // server so there is no flash. Crawlers carry no cookie and still get the page.
  beforeLoad: () => redirectSignedInHome(),
  head: () => pageHead({ path: "/" }),
  component: HomeRoute,
});

function HomeRoute() {
  // The hero and the capability stages deliberately render screenshots wider than
  // their frames and rely on the frame to clip them. `overflow-x-clip` on the page
  // makes that structural: it cannot produce a horizontal scrollbar even if a
  // frame's own clipping is defeated, and unlike `overflow-x-hidden` it does not
  // create a scroll container, so nothing inside loses `position: sticky`.
  return (
    <div className="min-h-svh overflow-x-clip bg-background text-foreground">
      <LandingNav />
      <main id="main" tabIndex={-1} className="flex flex-col">
        <LandingHero />
        <LandingCapabilities />
        <LandingOnTheFloor />
        <LandingTestimonials />
        <LandingFaq />
        <LandingClosing />
      </main>
    </div>
  );
}
