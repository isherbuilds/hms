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
   and only an external referrer. A route without params is its own path. */
export function trackPageViews(router: AnyRouter) {
  const origin = env.VITE_UMAMI_URL;
  const websiteId = env.VITE_UMAMI_WEBSITE_ID;

  if (!origin || !websiteId || typeof window === "undefined") return;

  let referrer = document.referrer.startsWith(location.origin) ? "" : document.referrer;

  const send = () => {
    const leaf = router.state.matches.at(-1);

    if (!leaf) return;

    const url = leaf.fullPath.includes("$") ? leaf.fullPath : location.pathname;

    window.umami?.track((props) => ({ ...props, url, title: "", referrer }));
    referrer = "";
  };

  const load = () => {
    const script = document.createElement("script");

    script.src = `${origin}/script.js`;
    script.dataset.websiteId = websiteId;
    script.dataset.autoTrack = "false";
    script.addEventListener("load", () => {
      send();
      // Filters and refreshes change only the search string; they are not page views.
      router.subscribe("onResolved", (event) => {
        if (event.pathChanged) send();
      });
    });
    document.head.append(script);
  };

  const whenIdle = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 5000 });
    else setTimeout(load, 2000);
  };

  if (document.readyState === "complete") whenIdle();
  else addEventListener("load", whenIdle, { once: true });
}
