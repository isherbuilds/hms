import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// One .env for the whole monorepo, resolved from this file rather than the
// working directory. Turbo, bun and drizzle-kit each start processes in a
// different directory, so a cwd-relative lookup would need a hardcoded
// `--env-file` path at every call site.
//
// Real environment variables always win: dotenv does not overwrite a name that
// is already set, which is what lets the test preload and container runtimes
// override these values.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
  quiet: true,
});
