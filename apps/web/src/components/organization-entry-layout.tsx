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
    <main className="flex min-h-svh flex-col bg-background lg:grid lg:grid-cols-[minmax(16rem,0.72fr)_minmax(30rem,1fr)]">
      <aside className="order-2 flex min-h-56 flex-col justify-between gap-8 border-t border-border bg-muted/25 p-6 lg:order-1 lg:min-h-svh lg:border-t-0 lg:border-r lg:p-8">
        <Link to="/" className="w-fit text-xs font-medium tracking-[0.18em] text-foreground">
          HMS
        </Link>

        <div className="max-w-md">
          <p className="font-mono text-xs tracking-widest text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-3 text-xl leading-tight font-medium tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>

        {aside ? <div className="text-xs text-muted-foreground">{aside}</div> : null}
      </aside>

      <section className="order-1 flex min-h-svh items-center justify-center p-6 lg:order-2 lg:p-12">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
