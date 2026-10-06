// A push to `main` deploys, and the server applies migrations before serving
// (docs/operations.md), so every migration on `main` has already run in production.
// Those files stay byte-identical and the journal only grows (AGENTS.md hard rule 4).
// The D042 squash broke this rule and was reinstated in 9172e35.
import { $ } from "bun";

const base = process.argv[2] ?? "origin/main";

const dir = "packages/db/src/migrations";

const journal = `${dir}/meta/_journal.json`;

const diff = await $`git diff --name-status --no-renames ${base} -- ${dir}`.text();

const problems: string[] = [];

for (const line of diff.split("\n")) {
  const [status, path] = line.split("\t");

  if (!path || status === "A") continue;

  if (path === journal && status === "M") {
    const deployed = JSON.parse(await $`git show ${base}:${journal}`.text()).entries;
    const current = (await Bun.file(journal).json()).entries.slice(0, deployed.length);

    if (JSON.stringify(current) === JSON.stringify(deployed)) continue;
  }

  problems.push(`${status === "D" ? "deleted" : "changed"}: ${path}`);
}

if (problems.length > 0) {
  console.error(
    `Migrations on ${base} already ran in production:\n  ${problems.join("\n  ")}\n` +
      `Restore them with \`git checkout ${base} -- ${dir}\`, then put the change in a new migration with \`bun run db:generate\`.`,
  );
  process.exit(1);
}
