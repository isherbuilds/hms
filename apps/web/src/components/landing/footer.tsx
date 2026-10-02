import { Link } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Wordmark } from "@/components/brand/wordmark";

import { EYEBROW, WRAP } from "./primitives";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/#journey" },
      { label: "For your team", href: "/#roles" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Log in", href: "/login" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About Edernal", href: "/about" },
      { label: "Customers", href: "/customers" },
      { label: "Careers", href: "/careers" },
      { label: "Contact", href: "/contact" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Data security", href: "/security" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Status", href: "/status" },
    ],
  },
];

/* CSS chooses the icon before hydration; resolvedTheme is only read on click. */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="rounded-md p-1.5 text-band-muted transition-[color,transform] duration-150 ease-out-strong active:scale-[0.97] pointer-fine:hover:text-band-foreground"
    >
      <SunIcon aria-hidden className="hidden size-4 dark:block" />
      <MoonIcon aria-hidden className="size-4 dark:hidden" />
    </button>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-band-line bg-band pt-14 pb-10 text-band-foreground">
      <div className={WRAP}>
        <div className="grid grid-cols-2 gap-10 md:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="col-span-full lg:col-span-1">
            <Link to="/" aria-label="Edernal Care home" className="inline-block">
              <Wordmark
                className="h-5.5 w-auto max-md:h-[19px]"
                careClassName="fill-brand-bright"
              />
            </Link>
            <p className="mt-4 max-w-80 text-sm leading-6 text-band-muted">
              Hospital management software for Indian hospitals and clinics. Part of the Edernal
              family of business software.
            </p>
            <div className="mt-5.5 flex flex-wrap gap-2">
              {["care", "school", "accounts"].map((product) => (
                <span
                  key={product}
                  className="rounded-full border border-band-line px-3 py-1 text-sm text-band-muted"
                >
                  <b className="font-medium text-band-foreground">edernal</b> {product}
                </span>
              ))}
            </div>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className={`${EYEBROW} mb-3.5 text-band-muted`}>{column.heading}</h2>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm no-underline pointer-fine:hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col justify-between gap-6 border-t border-band-line pt-6 text-sm text-band-muted md:flex-row md:items-center">
          <span>© 2026 Edernal. [Registered company name and address].</span>
          <div className="flex items-center gap-6">
            <span>Made in India</span>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
