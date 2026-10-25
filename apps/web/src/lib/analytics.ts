import { env } from "@hms/env/web";

/* Cookieless Umami page counts, kept off the critical path: the tracker is
   requested only after `load`, once the main thread is idle, so it never
   competes with hydration or the first interaction. It cannot run in a worker
   (Partytown): it wraps the page's own `history.pushState` to see client-side
   navigations. Query strings stay out: org pages carry filters and search text. */
function umamiLoader(origin: string, websiteId: string) {
  const src = JSON.stringify(`${origin}/script.js`);
  const id = JSON.stringify(websiteId);

  return `addEventListener("load",()=>{const s=()=>{const t=document.createElement("script");t.src=${src};t.dataset.websiteId=${id};t.dataset.excludeSearch="true";document.head.append(t)};"requestIdleCallback"in window?requestIdleCallback(s,{timeout:5000}):setTimeout(s,2000)},{once:true});`;
}

export const analyticsScripts =
  env.VITE_UMAMI_URL && env.VITE_UMAMI_WEBSITE_ID
    ? [{ children: umamiLoader(env.VITE_UMAMI_URL, env.VITE_UMAMI_WEBSITE_ID) }]
    : [];
