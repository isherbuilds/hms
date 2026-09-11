import { expect, test } from "bun:test";

test("React component sources do not contain bigint zero literals", async () => {
  const offenders: string[] = [];

  for await (const path of new Bun.Glob("apps/web/src/**/*.tsx").scan(".")) {
    if (/\b0n\b/.test(await Bun.file(path).text())) offenders.push(path);
  }

  // The enabled React Compiler currently emits `undefined` for a `0n` literal in
  // a component. Keep zero construction in plain lib modules until upstream fixes it.
  expect(offenders).toEqual([]);
});
