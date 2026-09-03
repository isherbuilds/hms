import { Toaster } from "@hms/ui/components/sonner";
import { ThemeProvider } from "next-themes";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import appCss from "../index.css?url";
export interface RouterAppContext {
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
        <a
          href="#main"
          className="sr-only fixed top-0 left-0 z-50 bg-background px-2 py-1 text-xs focus-visible:not-sr-only focus-visible:fixed"
        >
          Skip to main content
        </a>
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
