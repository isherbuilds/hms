import { Link } from "@tanstack/react-router";
import { MailIcon, MessageCircleIcon, MoonIcon, PhoneIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Wordmark } from "@/components/brand/wordmark";

import { CONTACT_EMAIL, CONTACT_MAILTO, PHONE } from "@/lib/contact";

import { WRAP } from "./primitives";

const LINKS = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Data security", href: "/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Log in", href: "/login" },
] as const;

/* CSS chooses the icon before hydration; resolvedTheme is only read on click. */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="rounded-md p-1.5 text-band-muted transition-[color,transform] duration-150 ease-out-strong active:scale-[0.97] pointer-fine:hover:text-band-foreground"
    >
      <span className="sr-only hidden dark:block">Switch to light theme</span>
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <SunIcon aria-hidden className="hidden size-4 dark:block" />
      <MoonIcon aria-hidden className="size-4 dark:hidden" />
    </button>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-band-line bg-band py-12 text-band-foreground">
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
            <div className="mt-6 flex flex-col gap-2.5 text-sm">
              <a
                href={CONTACT_MAILTO}
                className="inline-flex w-fit items-center gap-2.5 font-medium pointer-fine:hover:underline"
              >
                <MailIcon aria-hidden strokeWidth={1.75} className="size-4 text-band-muted" />
                {CONTACT_EMAIL}
              </a>
              {PHONE ? (
                <>
                  <a
                    href={PHONE.tel}
                    className="inline-flex w-fit items-center gap-2.5 font-medium pointer-fine:hover:underline"
                  >
                    <PhoneIcon aria-hidden strokeWidth={1.75} className="size-4 text-band-muted" />
                    {PHONE.display}
                  </a>
                  <a
                    href={PHONE.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-2.5 font-medium pointer-fine:hover:underline"
                  >
                    <MessageCircleIcon
                      aria-hidden
                      strokeWidth={1.75}
                      className="size-4 text-band-muted"
                    />
                    WhatsApp us
                  </a>
                </>
              ) : null}
            </div>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-12 gap-y-3.5">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm no-underline pointer-fine:hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-sm text-band-muted">
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
