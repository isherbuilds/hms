import { cleanupUploads } from "@hms/api/lib/upload-cleanup";
import { runMigrations } from "@hms/db/migrate";

const usage = "Usage: bun run cleanup-uploads --older-than-hours <n> [--delete]";
const args = process.argv.slice(2);
let hours: number | null = null;
let execute = false;
let valid = true;

for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--delete" && !execute) {
    execute = true;
    continue;
  }
  if (arg === "--older-than-hours" && hours === null) {
    const value = args[++index];
    if (value && /^[1-9]\d*$/.test(value)) {
      hours = Number(value);
      continue;
    }
  }
  valid = false;
  break;
}

const olderThanMs = hours === null ? Number.NaN : Date.now() - hours * 60 * 60 * 1000;
const olderThan = new Date(olderThanMs);
if (
  !valid ||
  hours === null ||
  !Number.isSafeInteger(hours) ||
  !Number.isFinite(olderThanMs) ||
  Number.isNaN(olderThan.getTime())
) {
  console.error(usage);
  process.exit(2);
}

await runMigrations();
const result = await cleanupUploads({ olderThan, execute });
console.info(
  `${execute ? "Cleanup" : "Dry run"}: ${result.staleRows} stale rows, ${result.orphanObjects} orphan objects, ${result.deleted} deleted, ${result.failed} failed, ${result.skipped} skipped.`,
);
process.exit(result.failed > 0 ? 1 : 0);
