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
    return url.origin === APP_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : defaultRedirect;
  } catch {
    return defaultRedirect;
  }
}
