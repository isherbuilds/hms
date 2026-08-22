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
    const decodedPath = decodeURIComponent(url.pathname).toLowerCase();
    if (
      decodedPath === "/login" ||
      decodedPath.startsWith("/login/") ||
      decodedPath.startsWith("/login?")
    ) {
      return defaultRedirect;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return defaultRedirect;
  }
}
