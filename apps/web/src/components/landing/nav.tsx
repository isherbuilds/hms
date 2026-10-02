import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/wordmark";

import { buttonClass, WRAP } from "./primitives";

const LINKS = [
  { label: "Features", href: "/#journey" },
  { label: "Teams", href: "/#roles" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md backdrop-saturate-150 transition-[background-color,border-color] duration-200 ease-out-strong ${
        scrolled ? "border-border bg-background/85" : "border-transparent bg-transparent"
      }`}
    >
      <div
        className={`${WRAP} flex h-[60px] items-center justify-between gap-3 md:h-[68px] md:gap-10`}
      >
        <Link to="/" aria-label="Edernal Care home" className="shrink-0 text-foreground">
          <Wordmark className="h-5.5 w-auto max-md:h-[19px]" />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center gap-7 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm text-sm font-medium text-muted-foreground no-underline transition-colors duration-150 pointer-fine:hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/login"
            className={buttonClass({ variant: "ghost", size: "sm", className: "max-md:hidden" })}
          >
            Log in
          </Link>
          <a href="/contact" className={buttonClass({ size: "sm" })}>
            Book a free demo
          </a>
        </div>
      </div>
    </header>
  );
}
