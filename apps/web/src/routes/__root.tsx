import { Toaster } from "@hms/ui/components/sonner";
import { ThemeProvider } from "next-themes";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import appCss from "../index.css?url";
interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },

  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "HMS",
      },
    ],
    links: [
      {
        // Declared explicitly so the browser does not probe `/favicon.ico`, which would
        // otherwise enter the `/$orgSlug` route.
        rel: "icon",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

/*
 * The router owns hash changes, so `href="#main"` alone only rewrites the URL —
 * the browser never moves focus. Move it here and the link actually skips.
 */
function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        const main = document.getElementById("main");
        if (!main) return;
        event.preventDefault();
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-sm"
    >
      Skip to main content
    </a>
  );
}

function RootDocument() {
  return (
    // The theme class is written onto <html> by next-themes before React hydrates, so
    // the server markup deliberately differs by that one attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Deliberately blocking: React Scan can only instrument renders if it
            runs before React does. Dev only, so it never ships. */}
        {import.meta.env.DEV && (
          <script
            crossOrigin="anonymous"
            integrity="sha384-DDZCsimcjpG92OUulxf7DHi4rGS/fNIW7lC5DT8+5ftaTDiUKfzIq+pDTUbPjC86"
            src="https://unpkg.com/react-scan@0.5.7/dist/auto.global.js"
          />
        )}
        <HeadContent />
      </head>
      <body>
        <SkipLink />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* App chrome belongs to the org shell (`AppShell`); public pages own
              their own layout. */}
          <Outlet />
          <Toaster richColors />
        </ThemeProvider>
        {import.meta.env.DEV && (
          <>
            <TanStackRouterDevtools position="bottom-left" />
            <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
          </>
        )}
        <Scripts />
      </body>
    </html>
  );
}
