import { env as serverEnv } from "@hms/env/server";
import { env as webEnv } from "@hms/env/web";
import { defineEventHandler, setResponseHeaders } from "nitro/h3";

const apiOrigin = new URL(webEnv.VITE_SERVER_URL).origin;
const storageOrigin = serverEnv.SEAWEEDFS_ENDPOINT
  ? new URL(serverEnv.SEAWEEDFS_ENDPOINT).origin
  : undefined;
const isDevelopment = import.meta.env.DEV;

const connectSrc = [
  "'self'",
  apiOrigin,
  ...(storageOrigin ? [storageOrigin] : []),
  ...(isDevelopment ? ["ws:"] : []),
].join(" ");

// TanStack Start emits an inline hydration script and exposes no nonce option.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(isDevelopment ? ["'unsafe-eval'", "https://unpkg.com"] : []),
].join(" ");

// The billing PDF is a web route framed by the same origin; nothing frames the API.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src ${connectSrc}`,
  "frame-src 'self'",
  `script-src ${scriptSrc}`,
].join("; ");

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    "Content-Security-Policy": contentSecurityPolicy,
    ...(serverEnv.NODE_ENV === "production"
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  });
});
