import type { ReactNode } from "react";

import { LandingClosing } from "./closing";
import { LandingNav } from "./nav";

/* The shell for a prose page — about, privacy, contact, changelog. Same chrome as
   every public page, a narrow measure for reading, and the shared closing. */
export function PublicPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh overflow-x-clip bg-background text-foreground">
      <LandingNav />
      <main id="main" tabIndex={-1} className="flex flex-col">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pt-16 sm:px-6 sm:pt-24">
          <header className="flex flex-col gap-4">
            {eyebrow ? <p className="text-sm text-muted-foreground">{eyebrow}</p> : null}
            <h1 className="text-4xl leading-[1.05] font-medium tracking-tight text-balance sm:text-5xl">
              {title}
            </h1>
            {lead ? <p className="text-lg text-muted-foreground text-pretty">{lead}</p> : null}
          </header>
          {children}
        </article>
        <LandingClosing />
      </main>
    </div>
  );
}

/* Long-form body copy. Written as child selectors rather than a typography
   plugin so the scale stays the one in docs/design.md §3: `text-base` body,
   `text-2xl` section titles, `text-xl` subsections. */
export const PROSE =
  "flex flex-col gap-5 text-base text-pretty [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-medium [&_h3]:tracking-tight [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_strong]:font-medium [&_strong]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_em]:italic";
