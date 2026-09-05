import { Link } from "@tanstack/react-router";

import { FEATURES } from "./features";
import { ProductWindow } from "./product-window";
import { Wash } from "./wash";

/* The section under the hero: an index of the feature pages, one card per
   module. Each card is a cropped slice of the real screen, the module's name and
   one line. The argument itself is made on the module's own page, so this grid
   holds its shape as modules are added. */

export function LandingCapabilities() {
  return (
    // Tight against the hero: no band between them, so the heading is the whole
    // transition.
    <section className="mx-auto flex w-full max-w-[84rem] flex-col gap-8 px-5 pt-16 sm:gap-12 sm:px-6">
      <div className="flex max-w-2xl flex-col gap-3 sm:mx-auto sm:items-center sm:text-center">
        <h2 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">
          The whole day, on three screens.
        </h2>
        <p className="text-lg text-muted-foreground text-pretty">
          Nothing is re-entered between them.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Link
            key={feature.to}
            to={feature.to}
            className="group flex flex-col overflow-hidden rounded-2xl bg-muted p-2 transition-colors duration-100 ease-out hover:bg-accent"
          >
            {/* The thumbnail repeats the card's own label, so it is decorative
                to a screen reader; the link's name is the text below. */}
            <div className="relative overflow-hidden rounded-xl p-4 sm:p-6">
              <Wash />
              <ProductWindow
                name={feature.shot}
                region={feature.thumbnail}
                alt=""
                title={`${feature.label} · Mercy General`}
                className="relative"
              />
            </div>
            <div className="flex flex-col gap-1 px-4 py-5">
              <span className="text-sm font-medium">{feature.label}</span>
              <span className="text-xs text-muted-foreground">{feature.blurb}</span>
              <span className="mt-2 text-sm underline-offset-4 group-hover:underline">
                See it in the product →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
