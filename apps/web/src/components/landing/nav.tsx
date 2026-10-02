import { Button } from "@hms/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@hms/ui/components/sheet";
import { MenuIcon } from "lucide-react";
import { ClientOnly, Link } from "@tanstack/react-router";
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
  const [open, setOpen] = useState(false);

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
            <Link
              key={link.href}
              to="/"
              hash={link.href.slice(2)}
              className="rounded-sm text-sm font-medium text-muted-foreground no-underline transition-colors duration-150 pointer-fine:hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/login"
            className={buttonClass({ variant: "ghost", size: "sm", className: "max-md:hidden" })}
          >
            Log in
          </Link>
          <Link to="/contact" className={buttonClass({ size: "sm", className: "max-sm:hidden" })}>
            Book a free demo
          </Link>
          <ClientOnly>
            <Sheet open={open} onOpenChange={setOpen}>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
                onClick={() => setOpen(true)}
              >
                <MenuIcon />
              </Button>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex flex-col gap-2 p-4">
                  {LINKS.map((link) => (
                    <Link
                      key={link.href}
                      to="/"
                      hash={link.href.slice(2)}
                      onClick={() => setOpen(false)}
                      className="rounded-md px-3 py-3 text-base"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <Link
                    to="/login"
                    onClick={() => setOpen(false)}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    Log in
                  </Link>
                  <Link to="/contact" onClick={() => setOpen(false)} className={buttonClass({})}>
                    Book a free demo
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </ClientOnly>
        </div>
      </div>
    </header>
  );
}
