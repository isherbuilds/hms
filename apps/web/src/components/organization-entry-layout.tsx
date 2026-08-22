import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function OrganizationEntryLayout({
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(16rem,0.72fr)_minmax(30rem,1fr)]">
      <aside className="flex min-h-56 flex-col justify-between gap-8 border-b border-border bg-muted/25 p-6 lg:min-h-svh lg:border-r lg:border-b-0 lg:p-8">
        <Link to="/" className="w-fit text-xs font-medium tracking-[0.18em] text-foreground">
          HMS
        </Link>

        <div className="max-w-md">
          <p className="font-mono text-xs tracking-widest text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-3 text-xl leading-tight font-medium tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>

        <div className="text-xs text-muted-foreground">{aside}</div>
      </aside>

      <section className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
