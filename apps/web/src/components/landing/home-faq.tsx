import { PlusIcon } from "lucide-react";

import { HOME_FAQS } from "@/content/faqs";

import { Accent, SECTION_HEADING, WRAP } from "./primitives";

export function HomeFaq() {
  return (
    <section id="faq" className="scroll-mt-20 py-20 [interpolate-size:allow-keywords] md:py-32">
      <div className={`${WRAP} flex flex-col items-center gap-10 md:gap-14`}>
        <h2 data-reveal className={`${SECTION_HEADING} text-center`}>
          What owners ask <Accent>us first.</Accent>
        </h2>
        <div data-reveal className="w-full max-w-[820px] border-t border-border">
          {/* Native details stay usable without JS; unsupported sizing interpolation
              falls back to an instant open without hiding any answers. A toggle from
              the keyboard marks the item `data-instant`, which drops its motion:
              keyboard-driven actions are never animated (AGENTS.md, UI). */}
          {HOME_FAQS.map((item) => (
            <details
              key={item.q}
              className="group border-b border-border details-content:overflow-clip details-content:opacity-0 details-content:[block-size:0] details-content:[transition:block-size_250ms_var(--ease-out-strong),opacity_200ms_var(--ease-out-strong),content-visibility_250ms_allow-discrete] open:details-content:opacity-100 open:details-content:[block-size:auto] data-instant:details-content:transition-none motion-reduce:details-content:transition-none"
            >
              <summary
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.currentTarget.parentElement!.dataset.instant = "";
                  }
                }}
                onPointerDown={(event) => {
                  delete event.currentTarget.parentElement!.dataset.instant;
                }}
                className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-4.5 text-lg font-medium transition-colors duration-150 pointer-fine:hover:text-brand md:py-5.5 [&::-webkit-details-marker]:hidden"
              >
                {item.q}
                <PlusIcon
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-5.5 shrink-0 transition-transform duration-200 ease-out-strong group-open:rotate-45 group-data-instant:transition-none"
                />
              </summary>
              <p className="pb-6 text-base leading-7 text-muted-foreground md:pr-12">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
