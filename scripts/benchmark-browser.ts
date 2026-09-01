const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";
const PROFILE_DIR = process.env.PERF_CHROME_PROFILE ?? "/tmp/hms-perf-chrome-profile";
const SESSION = process.env.PERF_CHROME_SESSION ?? "hms-perf-cold";
const SAMPLE_COUNT = Number(process.env.PERF_SAMPLES ?? 5);
const NETWORK = process.env.PERF_NETWORK;
const BROWSER_LABEL = process.env.PERF_BROWSER_LABEL ?? "Headless Chrome via chrome-devtools-axi";

const defaultRoutes = [
  "/mercy-general/dashboard",
  "/mercy-general/opd",
  "/mercy-general/settings/members",
  "/mercy-general/billing",
] as const;
const routes = process.env.PERF_ROUTES?.split(",").filter(Boolean) ?? defaultRoutes;
const expectedHeadings: Record<string, string> = {
  "/mercy-general/dashboard": "Dashboard",
  "/mercy-general/opd": "OPD",
  "/mercy-general/settings/members": "Members",
  "/mercy-general/billing": "Billing",
};

const browserEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  CHROME_DEVTOOLS_AXI_SESSION: SESSION,
  CHROME_DEVTOOLS_AXI_USER_DATA_DIR: PROFILE_DIR,
  // Keeps the persistent profile's disk cache from turning later samples into
  // warm-asset measurements.
  CHROME_DEVTOOLS_AXI_CHROME_ARGS: "--disk-cache-size=1 --media-cache-size=1",
};

const measurementExpression = `async () => {
  const buffered = (type) => new Promise((resolve) => {
    const values = [];
    const observer = new PerformanceObserver((list) => values.push(...list.getEntries()));
    try { observer.observe({ type, buffered: true }); } catch {}
    setTimeout(() => { observer.disconnect(); resolve(values); }, 100);
  });
  const nav = performance.getEntriesByType("navigation")[0];
  const paints = performance.getEntriesByType("paint");
  const [lcp, shifts, longtasks] = await Promise.all([
    buffered("largest-contentful-paint"),
    buffered("layout-shift"),
    buffered("longtask"),
  ]);
  const resources = performance.getEntriesByType("resource");
  const scripts = resources.filter((entry) => entry.initiatorType === "script");
  return {
    path: location.pathname,
    ttfbMs: nav?.responseStart,
    dclMs: nav?.domContentLoadedEventEnd,
    loadMs: nav?.loadEventEnd,
    fcpMs: paints.find((entry) => entry.name === "first-contentful-paint")?.startTime,
    lcpMs: lcp.at(-1)?.startTime,
    cls: shifts.filter((entry) => !entry.hadRecentInput).reduce((sum, entry) => sum + entry.value, 0),
    longTaskMs: longtasks.reduce((sum, entry) => sum + entry.duration, 0),
    requestCount: resources.length + 1,
    transferBytes: (nav?.transferSize ?? 0) + resources.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
    scriptTransferBytes: scripts.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
    scriptDecodedBytes: scripts.reduce((sum, entry) => sum + (entry.decodedBodySize ?? 0), 0),
    rpcCount: resources.filter((entry) => new URL(entry.name).pathname.startsWith("/rpc")).length,
    recoveryMarker: document.documentElement.innerHTML.includes("<!--$!-->"),
    heading: document.querySelector("h1")?.textContent?.trim(),
  };
}`;

async function axi(args: string[], tolerateFailure = false): Promise<string> {
  const process = Bun.spawn(["./node_modules/.bin/chrome-devtools-axi", ...args], {
    cwd: import.meta.dir + "/..",
    env: browserEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0 && !tolerateFailure) {
    throw new Error(`chrome-devtools-axi ${args[0]} failed: ${stderr || stdout}`);
  }
  return stdout;
}

function assertMeasurement(route: string, measurement: Record<string, unknown>): void {
  const expectedPath = new URL(route, BASE_URL).pathname;
  if (measurement.path !== expectedPath) {
    throw new Error(`Expected ${expectedPath}, reached ${String(measurement.path)}`);
  }
  const expectedHeading = expectedHeadings[expectedPath];
  if (expectedHeading && measurement.heading !== expectedHeading) {
    throw new Error(
      `${expectedPath} rendered ${String(measurement.heading)} instead of ${expectedHeading}`,
    );
  }
  if (measurement.recoveryMarker !== false) {
    throw new Error(`${expectedPath} contains an SSR recovery marker`);
  }
  if (measurement.rpcCount !== 0) {
    throw new Error(`${expectedPath} made ${String(measurement.rpcCount)} hydration RPC requests`);
  }
  if (typeof measurement.cls !== "number" || measurement.cls > 0.05) {
    throw new Error(`${expectedPath} exceeded the 0.05 CLS budget: ${String(measurement.cls)}`);
  }
  for (const metric of ["ttfbMs", "fcpMs", "lcpMs", "requestCount", "transferBytes"] as const) {
    if (typeof measurement[metric] !== "number" || !Number.isFinite(measurement[metric])) {
      throw new Error(`${expectedPath} did not produce a finite ${metric}`);
    }
  }
}

function parseMeasurement(output: string): Record<string, unknown> {
  const line = output.split("\n").find((candidate) => candidate.startsWith("result: "));
  if (!line) throw new Error(`No measurement result in:\n${output}`);
  const encoded = JSON.parse(line.slice("result: ".length));
  return JSON.parse(encoded);
}

await axi(["stop"], true);

const samples: Record<string, Array<Record<string, unknown>>> = {};
try {
  for (const route of routes) {
    samples[route] = [];
    // Discard the first run so database, SSR modules and fonts are warm while the HTTP
    // asset cache stays cold on each browser restart.
    for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
      console.error(
        `[browser benchmark] ${route} ${index === 0 ? "warm-up" : `sample ${index}/${SAMPLE_COUNT}`}`,
      );
      await axi(["stop"], true);
      await axi(["open", "about:blank"]);
      await axi(["resize", "1440", "900"]);
      if (NETWORK) await axi(["emulate", "--network", NETWORK]);
      await axi(["open", new URL(route, BASE_URL).toString()]);
      await axi(["wait", "500"]);
      const result = parseMeasurement(await axi(["eval", measurementExpression]));
      assertMeasurement(route, result);
      if (index > 0) samples[route]?.push(result);
    }
  }
} finally {
  await axi(["stop"], true);
}

const report = JSON.stringify(
  {
    capturedAt: new Date().toISOString(),
    browser: `${BROWSER_LABEL}, isolated persistent profile`,
    viewport: "1440x900",
    cache: "browser restart per sample; disk/media cache capped at 1 byte",
    network: NETWORK ?? "unthrottled",
    sampleCount: SAMPLE_COUNT,
    samples,
  },
  null,
  2,
);

if (process.env.PERF_OUTPUT) await Bun.write(process.env.PERF_OUTPUT, `${report}\n`);
console.log(report);
