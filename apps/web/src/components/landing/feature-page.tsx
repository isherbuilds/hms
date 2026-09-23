import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { LandingClosing } from "./closing";
import { LandingFaq } from "./faq";
import { FEATURES } from "./features";
import { HeroActions } from "./hero";
import { LandingNav } from "./nav";
import { ProductWindow, type Region, type ShotName } from "./product-window";
import { Wash } from "./wash";

/* One module's page: the argument the landing page has no room for. Hero, the
   real screen whole, three zooms each carrying one claim, the FAQ entries that
   module attracts, the other modules, then the shared closing.

   The deep panel treatment — a washed stage with the window floating on it and
   a text column beside it — lives here now; the landing page indexes these
   pages with cards. */

/* The screen entire, less the bottom strip: every capture carries the router
   devtools badge in the sidebar's last 60px, and a recapture is out of scope. */
const CAPTURE: Region = { x: 0, y: 0, w: 1440, h: 840 };

export function FeaturePage({
  shot,
  eyebrow,
  title,
  lead,
  windowTitle,
  captureAlt,
  crops,
}: {
  shot: ShotName;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  /* The window-chrome label, `"<Section> · Mercy General"`, on every window. */
  windowTitle: string;
  /* The full capture is informative and is described; each crop repeats the
     claim printed beside it and is hidden from assistive technology. */
  captureAlt: string;
  crops: { region: Region; claim: string; body: string }[];
}) {
  const siblings = FEATURES.filter((feature) => feature.shot !== shot);

  return (
    <div className="min-h-svh overflow-x-clip bg-background text-foreground">
      <LandingNav />
      <main id="main" tabIndex={-1} className="flex flex-col">
        <section className="relative mx-auto flex w-full max-w-[84rem] flex-col items-center gap-6 px-6 pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute top-[-6rem] bottom-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden"
          >
            <Wash className="opacity-70" />
            <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-background" />
          </div>
          <p className="text-sm text-muted-foreground">{eyebrow}</p>
          <h1 className="max-w-3xl text-4xl leading-[1.05] font-medium tracking-tight text-balance sm:text-center sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-lg text-lg text-muted-foreground text-pretty sm:text-center">
            {lead}
          </p>
          <HeroActions />

          {/* The screen whole, as the hero shows the dashboard: a phone visitor
              is evaluating desk software and gets the honest small picture. */}
          <div className="relative w-full overflow-hidden rounded-xl p-4 sm:p-6 lg:p-8">
            <Wash />
            <ProductWindow
              name={shot}
              region={CAPTURE}
              alt={captureAlt}
              title={windowTitle}
              className="relative"
            />
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-[84rem] flex-col gap-8 px-5 pt-16 sm:gap-16 sm:px-6">
          {crops.map((crop, i) => {
            const textRight = i % 2 === 1;

            return (
              <div
                key={crop.claim}
                className={`grid items-center gap-4 rounded-xl bg-muted p-2 sm:p-3 lg:gap-8 ${
                  textRight
                    ? "lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]"
                    : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)]"
                }`}
              >
                <div
                  className={`flex flex-col gap-3 px-4 py-5 sm:px-6 sm:py-6 lg:px-10 ${
                    textRight ? "lg:order-2" : ""
                  }`}
                >
                  <h2 className="text-2xl font-medium tracking-tight text-balance">{crop.claim}</h2>
                  <p className="text-base text-muted-foreground text-pretty">{crop.body}</p>
                </div>

                {/* On a phone the window is cropped rather than shrunk: rendered
                    at 44rem and anchored left so the frame clips the overflow. A
                    table squeezed into a 320px column argues nothing. */}
                <div className="relative grid justify-items-start overflow-hidden rounded-xl p-4 sm:min-h-[24rem] sm:place-items-center sm:p-10 lg:min-h-[32rem] lg:p-14">
                  <Wash />
                  <ProductWindow
                    name={shot}
                    region={crop.region}
                    alt=""
                    title={windowTitle}
                    className="relative w-[44rem] max-w-none sm:w-full"
                  />
                </div>
              </div>
            );
          })}
        </section>

        <LandingFaq feature={shot} />

        {/* The other modules: the buyer reading about billing sees that the
            queue and the records are the same system, not a point solution. */}
        <section
          aria-labelledby="also"
          className="mx-auto flex w-full max-w-[84rem] flex-col gap-6 px-5 pt-20 sm:px-6 sm:pt-28"
        >
          <h2 id="also" className="text-sm text-muted-foreground">
            One system. Also in it:
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {siblings.map((feature) => (
              <Link
                key={feature.to}
                to={feature.to}
                className="group flex items-center gap-4 rounded-lg border border-border p-4 transition-colors duration-100 ease-out hover:bg-muted"
              >
                <feature.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex flex-col gap-2">
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{feature.label}</span>
                    <span className="text-xs text-muted-foreground">{feature.blurb}</span>
                  </span>
                  <span className="text-sm underline-offset-4 group-hover:underline">See it →</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <LandingClosing />
      </main>
    </div>
  );
}
