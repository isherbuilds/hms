import type { ReactNode } from "react";

import { LandingFinal } from "./final-cta";
import { LandingFooter } from "./footer";
import { LandingNav } from "./nav";
import { RevealRoot } from "./reveal";

/* Prose pages share the public chrome while retaining a narrow reading measure. */
export function PublicPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <RevealRoot className="min-h-svh overflow-x-clip bg-background text-foreground">
      <LandingNav />
      <main id="main" tabIndex={-1} className="flex flex-col">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pt-16 pb-20 sm:px-6 sm:pt-24">
          <header className="flex flex-col gap-4">
            <h1 className="text-4xl leading-[1.05] font-medium tracking-tight text-balance sm:text-5xl">
              {title}
            </h1>
            {lead ? <p className="text-lg text-muted-foreground text-pretty">{lead}</p> : null}
          </header>
          {children}
        </article>
        <LandingFinal />
      </main>
      <LandingFooter />
    </RevealRoot>
  );
}

/* Long-form body copy also renders MDX changelog entries, whose headings and
   paragraphs cannot be grouped in JSX; heading margins preserve their hierarchy.
   The shared scale stays the one in docs/design.md §3. */
export const PROSE =
  "flex flex-col gap-4 text-base text-pretty [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-medium [&_h3]:tracking-tight [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_strong]:font-medium [&_strong]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_em]:italic";
