import { Link } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Wordmark } from "@/components/brand/wordmark";

import { PHONE_DISPLAY, PHONE_TEL, WHATSAPP_URL } from "@/lib/contact";

import { WRAP } from "./primitives";

const LINKS = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Data security", href: "/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Log in", href: "/login" },
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
    <footer className="bg-band py-10 text-band-foreground">
      <div className={WRAP}>
        <div className="flex flex-col justify-between gap-8 md:flex-row md:gap-12">
          <div className="max-w-sm">
            <Link to="/" aria-label="Edernal Care home" className="inline-block">
              <Wordmark
                className="h-5.5 w-auto max-md:h-[19px]"
                careClassName="fill-brand-bright"
              />
            </Link>
            <p className="mt-4 text-sm leading-6 text-band-muted">
              Patient records, OPD, billing and pharmacy for hospitals and clinics.
            </p>
            <p className="mt-3 text-sm leading-6 text-band-muted">
              Part of{" "}
              <a
                href="https://eternal.com"
                className="text-band-foreground underline underline-offset-4"
              >
                Eternal
              </a>
              , alongside Eternal Campus and Eternal Books.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <a href={PHONE_TEL} className="pointer-fine:hover:underline">
                {PHONE_DISPLAY}
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-fine:hover:underline"
              >
                WhatsApp us
              </a>
            </div>
          </div>
          <nav aria-label="Footer" className="md:max-w-xs">
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm no-underline pointer-fine:hover:underline">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-band-muted">
          <span>© 2026 Edernal Care</span>
          <div className="flex items-center gap-4">
            <span>Made in India</span>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
