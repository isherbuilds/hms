import { Button } from "@hms/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, MenuIcon, MoonIcon, SunIcon, XIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { FEATURES } from "./features";

/* The public page's chrome.

   The bar is three columns rather than `justify-between`: the wordmark and the
   action cluster have different widths, so space-between would leave the nav
   wherever the remainder falls instead of on the page's axis. The third column
   is occupied at every width so the center link cluster stays centered.

   The header is quiet by design — Midday's, not the average SaaS bar. Nav links
   are plain text at weight 400 with no box and no pill; only a hover colour
   shift. The open Product trigger gets no fill — the band beneath it is the
   state. The two actions are a thin outline "Contact us" beside a filled
   "Sign in" (docs/research/landing-header-anatomy.md), and both sit at normal
   weight so they don't outweigh the nav. The theme control lives in the footer,
   not here; the bigger ask stays in the hero and the closing panel. */

/* The only theme control on a public page: the sidebar's `ThemeToggle` is a
   `SidebarMenuButton` and cannot be lifted out of the app shell.

   The rendered markup must not depend on the resolved theme. `resolvedTheme` is
   undefined during SSR, so branching on it here hydrates as a mismatch; the
   `dark` class is already on <html> before React runs, so CSS can pick the icon
   with no branch at all. The click handler reads the theme at click time, which
   is always after mount. */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="rounded-md p-1.5 text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground"
    >
      <SunIcon className="hidden size-4 dark:block" />
      <MoonIcon className="size-4 dark:hidden" />
    </button>
  );
}

/* Grouped on the app's own sidebar shelves — Care, Finance — so the marketing
   menu and the product's navigation never use two words for one thing, and a
   new module lands in a shelf that already exists rather than adding a column. */
const SHELVES = (["Care", "Finance"] as const).map((name) => ({
  name,
  modules: FEATURES.filter((feature) => feature.shelf === name),
}));

/* The header's own links are plain text at body size and normal weight — no
   background, no box, no `font-medium`. Midday's nav sits at weight 400 with
   only the logo heavier; that is what keeps a bar quiet. Only a hover colour
   shift; no pill, no underline. */
const LINK =
  "px-2.5 py-1.5 text-sm font-normal text-foreground transition-colors duration-100 ease-out hover:text-muted-foreground";

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const productTrigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto grid h-14 w-full max-w-336 grid-cols-[1fr_auto_1fr] items-center gap-6 px-5 sm:px-6">
        <Link to="/" className="justify-self-start text-sm font-medium">
          HMS
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {/* The full-height group leaves no gap between trigger and panel.
              Its links also follow the trigger in keyboard tab order. */}
          <div
            className="flex h-14 items-center"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setOpen(true);
            }}
            onPointerLeave={(event) => {
              if (
                event.pointerType === "mouse" &&
                !event.currentTarget.contains(document.activeElement)
              ) {
                setOpen(false);
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                setOpen(false);
                productTrigger.current?.focus();
              }
            }}
          >
            <button
              ref={productTrigger}
              type="button"
              aria-expanded={open}
              onClick={(event) => {
                // Hover already opened it for a mouse; taps and keyboard toggle.
                const mouse =
                  "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "mouse";

                setOpen((value) => (mouse ? true : !value));
              }}
              className={`flex items-center gap-1 ${LINK}`}
            >
              Product
              <ChevronDownIcon
                data-open={open || undefined}
                className="size-3 text-muted-foreground transition-transform duration-200 ease-out data-open:rotate-180 motion-reduce:transition-none"
              />
            </button>
            {open ? (
              /* The Midday band: one hairline top and bottom, the page's own
               surface, no shadow. The bar above stays visible, so the menu
               reads as a continuation of it rather than as a popover. */
              <div className="absolute inset-x-0 top-14 origin-top animate-in border-b border-border bg-background duration-150 ease-out fade-in slide-in-from-top-1 motion-reduce:animate-none">
                <div className="mx-auto grid w-full max-w-336 grid-cols-2 gap-x-8 px-5 py-6 sm:px-6">
                  {SHELVES.map((shelf) => (
                    <div key={shelf.name}>
                      <p className="pb-1 text-xs text-muted-foreground">{shelf.name}</p>
                      <ul className="flex flex-col">
                        {shelf.modules.map((item) => (
                          <li key={item.to}>
                            <Link
                              to={item.to}
                              onClick={() => setOpen(false)}
                              className="group -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors duration-100 ease-out hover:bg-muted"
                            >
                              <span className="text-sm">{item.label}</span>
                              <span className="text-xs text-muted-foreground">{item.blurb}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border">
                  <div className="mx-auto flex w-full max-w-336 items-center justify-between px-5 py-3 text-sm sm:px-6">
                    <p className="text-muted-foreground">
                      One login and one patient record across all of them.
                    </p>
                    <Link
                      to="/opd"
                      onClick={() => setOpen(false)}
                      className="text-foreground transition-colors duration-100 ease-out hover:text-muted-foreground"
                    >
                      See them in the product →
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {/* `Link hash`, not `<a href="#…">`: the router owns hash changes, so
              a raw href only rewrites the URL — the browser never scrolls (the
              same reason the skip link moves focus by hand). A router link
              scrolls, and lands from any page, not just `/`. */}
          <Link to="/" hash="faq" className={LINK}>
            Questions
          </Link>
          <Link to="/about" className={LINK}>
            About
          </Link>
          <Link to="/changelog" className={LINK}>
            Changelog
          </Link>
        </nav>
        {/* The mobile hamburger stands in for the center column so the third
            column's width matches and the wordmark stays put. */}
        <div className="md:hidden" />

        <div className="flex items-center gap-2 justify-self-end">
          <Button
            variant="outline"
            className="hidden font-normal normal-case sm:inline-flex"
            nativeButton={false}
            render={<Link to="/contact" />}
          >
            Contact us
          </Button>
          <Button
            className="font-normal normal-case"
            nativeButton={false}
            render={<Link to="/login" />}
          >
            Sign in
          </Button>
          <button
            type="button"
            className="rounded-md p-1.5 transition-colors duration-100 ease-out hover:text-muted-foreground md:hidden"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
      </div>

      {/* `absolute`, not `fixed`: the bar's `backdrop-blur` makes the header a
          containing block, so a fixed child would be trapped in its 56px box.

          It stops short of the viewport bottom on purpose. A sheet that fills the
          screen turns the page into a modal the reader has to dismiss; leaving a
          strip showing keeps the page obviously still there, and `overscroll-auto`
          lets a flick past the menu's end carry on scrolling it. */}
      {menu ? (
        <div className="absolute inset-x-0 top-14 max-h-[calc(100svh-8rem)] animate-in overflow-y-auto overscroll-auto rounded-b-xl border-b border-border bg-background shadow-lg duration-150 ease-out fade-in slide-in-from-top-2 motion-reduce:animate-none md:hidden">
          <nav className="flex flex-col gap-6 px-5 py-6 text-sm" aria-label="Main">
            {SHELVES.map((shelf) => (
              <div key={shelf.name} className="flex flex-col gap-1">
                <p className="px-3 pb-1 text-xs text-muted-foreground">{shelf.name}</p>
                {shelf.modules.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenu(false)}
                    className="flex gap-3 rounded-lg p-3 transition-colors duration-100 ease-out hover:bg-muted"
                  >
                    <item.icon className="size-4 shrink-0 self-start text-muted-foreground" />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-normal">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.blurb}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ))}
            <div className="flex flex-col">
              <Link
                to="/"
                hash="faq"
                onClick={() => setMenu(false)}
                className="rounded-md px-3 py-3 text-muted-foreground transition-colors duration-100 ease-out hover:bg-muted hover:text-foreground"
              >
                Questions
              </Link>
              <Link
                to="/about"
                onClick={() => setMenu(false)}
                className="rounded-md px-3 py-3 text-muted-foreground transition-colors duration-100 ease-out hover:bg-muted hover:text-foreground"
              >
                About
              </Link>
              <Link
                to="/changelog"
                onClick={() => setMenu(false)}
                className="rounded-md px-3 py-3 text-muted-foreground transition-colors duration-100 ease-out hover:bg-muted hover:text-foreground"
              >
                Changelog
              </Link>
              <Link
                to="/contact"
                onClick={() => setMenu(false)}
                className="rounded-md px-3 py-3 text-muted-foreground transition-colors duration-100 ease-out hover:bg-muted hover:text-foreground sm:hidden"
              >
                Contact sales
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
