export {};

const WEB_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";
const API_URL = process.env.PERF_API_URL ?? "http://127.0.0.1:3100";
const EMAIL = process.env.PERF_EMAIL;
const PASSWORD = process.env.PERF_PASSWORD;
const ROUND_COUNT = Number(process.env.PERF_ROUNDS ?? 3);
const ROUTE = process.env.PERF_ROUTE ?? "/mercy-general/dashboard";

if (!EMAIL || !PASSWORD) {
  throw new Error("Set PERF_EMAIL and PERF_PASSWORD to a benchmark fixture account");
}

type Round = {
  concurrency: number;
  requests: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  failures: number;
};

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function signIn(): Promise<string> {
  const response = await fetch(new URL("/api/auth/sign-in/email", API_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: WEB_URL,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Benchmark sign-in failed: ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) throw new Error("Benchmark sign-in returned no session cookie");
  return cookie;
}

async function runRound(cookie: string, concurrency: number, requests: number): Promise<Round> {
  const routeUrl = new URL(ROUTE, WEB_URL);
  const durations: number[] = [];
  let failures = 0;
  let next = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= requests) return;

        const requestStartedAt = performance.now();
        const response = await fetch(routeUrl, {
          headers: { cookie },
        });
        await response.arrayBuffer();
        durations.push(performance.now() - requestStartedAt);
        // fetch follows redirects by default. A stale fixture can otherwise turn
        // an auth redirect followed by a fast 200 login page into a false pass.
        if (!response.ok || response.url !== routeUrl.href) failures += 1;
      }
    }),
  );

  const elapsedMs = performance.now() - startedAt;
  durations.sort((left, right) => left - right);
  return {
    concurrency,
    requests,
    requestsPerSecond: (requests * 1000) / elapsedMs,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    failures,
  };
}

const cookie = await signIn();
for (let index = 0; index < 10; index += 1) {
  await runRound(cookie, 1, 1);
}

const rounds: Round[] = [];
for (let index = 0; index < ROUND_COUNT; index += 1) {
  console.error(`[server benchmark] round ${index + 1}/${ROUND_COUNT}, concurrency 1`);
  rounds.push(await runRound(cookie, 1, 100));
  console.error(`[server benchmark] round ${index + 1}/${ROUND_COUNT}, concurrency 30`);
  rounds.push(await runRound(cookie, 30, 300));
}

const failureCount = rounds.reduce((total, round) => total + round.failures, 0);
if (failureCount > 0) {
  throw new Error(`Server benchmark observed ${failureCount} failed or redirected documents`);
}

const report = JSON.stringify(
  {
    capturedAt: new Date().toISOString(),
    route: ROUTE,
    warmupRequests: 10,
    rounds,
  },
  null,
  2,
);

if (process.env.PERF_OUTPUT) await Bun.write(process.env.PERF_OUTPUT, `${report}\n`);
console.log(report);
