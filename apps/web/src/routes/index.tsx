import { createFileRoute } from "@tanstack/react-router";

import { LandingFinal } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";
import { LandingGoLive } from "@/components/landing/go-live";
import { LandingHero } from "@/components/landing/hero";
import { HomeFaq } from "@/components/landing/home-faq";
import { LandingIndia } from "@/components/landing/india";
import { LandingJourney } from "@/components/landing/journey";
import { LandingNav } from "@/components/landing/nav";
import { LandingOwner } from "@/components/landing/owner";
import { LandingPricing } from "@/components/landing/pricing";
import { RevealRoot } from "@/components/landing/reveal";
import { LandingRoles } from "@/components/landing/roles-scroll";
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
  // The product previews deliberately render wider than their frames and rely
  // on each frame to clip them. `overflow-x-clip` makes that structural: previews
  // cannot produce a horizontal scrollbar even if a frame's clipping is defeated,
  // and unlike `overflow-x-hidden` it does not create a scroll container, so the
  // sticky navigation keeps its viewport anchor.
  return (
    <RevealRoot className="min-h-svh overflow-x-clip bg-background text-foreground">
      <LandingNav />
      <main id="main" tabIndex={-1}>
        <LandingHero />
        <LandingJourney />
        <LandingRoles />
        <LandingOwner />
        <LandingIndia />
        <LandingGoLive />
        <LandingPricing />
        <HomeFaq />
        <LandingFinal />
      </main>
      <LandingFooter />
    </RevealRoot>
  );
}
