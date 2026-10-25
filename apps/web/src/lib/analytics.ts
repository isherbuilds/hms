import { env } from "@hms/env/web";
import type { AnyRouter } from "@tanstack/react-router";

type UmamiPayload = { url: string; title: string; referrer: string };

declare global {
  interface Window {
    umami?: { track: (payload: (props: UmamiPayload) => UmamiPayload) => void };
  }
}

/* Cookieless Umami page counts, kept off the critical path: the tracker is
   requested only after `load`, once the main thread is idle. It cannot run in a
   worker (Partytown), which would not see the router's navigations.

   Automatic tracking is off because it sends `document.title` and the full
   address, and org pages put names and record ids in both. Each view sends the
   matched route pattern instead (`/$orgSlug/invoices/$invoiceId`) with no title,
   and only an external referrer. A route without params is its own path.

   Call after hydration: hydration emits no `onResolved`, so the first page is
   read from router state here. Returns the cleanup. */
export function trackPageViews(router: AnyRouter) {
  const origin = env.VITE_UMAMI_URL;
  const websiteId = env.VITE_UMAMI_WEBSITE_ID;

  if (!origin || !websiteId) return undefined;

  let referrer = document.referrer.startsWith(location.origin) ? "" : document.referrer;
  let lastPath: string | undefined;
  let ready = false;
  const pending: string[] = [];

  const send = (url: string) => {
    window.umami?.track((props) => ({ ...props, url, title: "", referrer }));
    referrer = "";
  };

  /* Called only with the resolved location, so the path and `state.matches`
     describe the same page. A repeat of the last path is not a new view. */
  const record = (pathname: string) => {
    const leaf = router.state.matches.at(-1);

    if (!leaf || pathname === lastPath) return;

    lastPath = pathname;
    const url = leaf.fullPath.includes("$") ? leaf.fullPath : pathname;

    if (ready) send(url);
    else pending.push(url);
  };

  const first = router.state.resolvedLocation;

  if (first) record(first.pathname);

  // Filters and refreshes change only the search string; `record` skips them.
  const unsubscribe = router.subscribe("onResolved", (event) => record(event.toLocation.pathname));

  const script = document.createElement("script");

  script.src = `${origin}/script.js`;
  script.dataset.websiteId = websiteId;
  script.dataset.autoTrack = "false";
  script.addEventListener("load", () => {
    ready = true;

    for (const url of pending.splice(0)) send(url);
  });

  let disposed = false;

  const inject = () => {
    if (!disposed) document.head.append(script);
  };

  const whenIdle = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(inject, { timeout: 5000 });
    else setTimeout(inject, 2000);
  };

  if (document.readyState === "complete") whenIdle();
  else addEventListener("load", whenIdle, { once: true });

  return () => {
    disposed = true;
    unsubscribe();
    removeEventListener("load", whenIdle);
    script.remove();
  };
}
