import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Resolved from this file, not the working directory: turbo, bun and drizzle-kit
// each start in a different one. Real environment variables always win, which is
// what lets the test preload and container runtimes override these.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
  quiet: true,
});
