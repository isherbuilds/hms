import type { AppRouter } from "@hms/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

const API_URL = process.env.PERF_API_URL ?? "http://127.0.0.1:3100";

const WEB_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";

const EMAIL = process.env.PERF_EMAIL;

const PASSWORD = process.env.PERF_PASSWORD;

const REQUEST_COUNT = Number(process.env.PERF_RPC_REQUESTS ?? 200);

const WARMUP_COUNT = 20;

const ORG_SLUG = "mercy-general";

if (!EMAIL || !PASSWORD) {
  throw new Error("Set PERF_EMAIL and PERF_PASSWORD to a benchmark fixture account");
}

if (!Number.isInteger(REQUEST_COUNT) || REQUEST_COUNT < 1) {
  throw new Error("PERF_RPC_REQUESTS must be a positive integer");
}

type Scenario = {
  name: string;
  /** Awaited for its timing only; the payload is discarded. */
  run: () => Promise<void>;
};

type ScenarioReport = {
  scenario: string;
  requests: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
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

function createClient(cookie: string): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${API_URL}/rpc`,
    headers: {
      cookie,
      origin: WEB_URL,
    },
  });

  return createORPCClient(link);
}

async function runScenario(scenario: Scenario): Promise<ScenarioReport> {
  let failures = 0;

  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    try {
      await scenario.run();
    } catch {
      failures += 1;
    }
  }

  const durations: number[] = [];

  for (let index = 0; index < REQUEST_COUNT; index += 1) {
    const startedAt = performance.now();

    try {
      await scenario.run();
    } catch {
      failures += 1;
    }

    durations.push(performance.now() - startedAt);
  }

  if (failures > 0) {
    throw new Error(`RPC benchmark scenario ${scenario.name} observed ${failures} failed requests`);
  }

  durations.sort((left, right) => left - right);

  return {
    scenario: scenario.name,
    requests: REQUEST_COUNT,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    meanMs: durations.reduce((total, duration) => total + duration, 0) / durations.length,
    failures,
  };
}

const cookie = await signIn();

const client = createClient(cookie);

const scenarios: Scenario[] = [
  {
    name: "patients_first_page",
    run: async () => client.patient.search({ orgSlug: ORG_SLUG, limit: 20 }),
  },
  {
    name: "patients_query_ra",
    run: async () => client.patient.search({ orgSlug: ORG_SLUG, query: "ra", limit: 20 }),
  },
  {
    name: "patients_phone_9876",
    run: async () => client.patient.search({ orgSlug: ORG_SLUG, phone: "9876", limit: 20 }),
  },
  {
    name: "catalog_list",
    run: async () => client.catalog.list({ orgSlug: ORG_SLUG, activeOnly: false }),
  },
];

const scenarioReports: ScenarioReport[] = [];

for (const scenario of scenarios) {
  scenarioReports.push(await runScenario(scenario));
}

const report = JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    requestsPerScenario: REQUEST_COUNT,
    scenarios: scenarioReports,
  },
  null,
  2,
);

if (process.env.PERF_OUTPUT) await Bun.write(process.env.PERF_OUTPUT, `${report}\n`);

console.log(report);
