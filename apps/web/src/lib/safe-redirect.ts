const DEFAULT_REDIRECT = "/";
const APP_ORIGIN = "https://app.invalid";

export function safeRedirect(to: unknown, defaultRedirect = DEFAULT_REDIRECT): string {
  if (typeof to !== "string") {
    return defaultRedirect;
  }

  const trimmed = to.trim();
  if (!trimmed.startsWith("/")) {
    return defaultRedirect;
  }

  try {
    const url = new URL(trimmed, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) {
      return defaultRedirect;
    }
    // Allowlist, not denylist: only pages a signed-in user can actually land
    // on are worth returning to. Anything else — /login itself, nested
    // /login?redirect=… chains (whose encoded "?" hides inside the pathname),
    // or arbitrary paths — falls back so the chain always terminates.
    if (url.pathname !== "/onboarding" && !url.pathname.startsWith("/org/")) {
      return defaultRedirect;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return defaultRedirect;
  }
}
