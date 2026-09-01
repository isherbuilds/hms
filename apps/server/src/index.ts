import { drainAuditWrites } from "@hms/api/audit";
import { createRequestContext, type ORPCContext } from "@hms/api/lib/context";
import { appRouter } from "@hms/api/routers/index";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { env } from "@hms/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { BodyLimitPlugin, RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { sql } from "drizzle-orm";
import { initLogger } from "evlog";
import { identifyUser } from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { evlog, type EvlogVariables } from "evlog/hono";
import { compress } from "hono/compress";
import { Hono, type Context as HonoContext } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

initLogger({
  env: { service: "hms-server" },
});

const isProduction = env.NODE_ENV === "production";
export const app = new Hono<EvlogVariables>();

app.use(
  evlog({
    drain: isProduction ? undefined : createFsDrain(),
  }),
);
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    // Cache preflight responses so cross-origin RPCs don't pay an OPTIONS round trip.
    maxAge: 86400,
  }),
);
app.use("/*", compress());

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function createLoggedRequestContext(
  context: HonoContext<EvlogVariables>,
): Promise<ORPCContext> {
  const startedAt = Date.now();
  const requestContext = await createRequestContext(context.req.raw.headers);
  const identified = requestContext.session
    ? identifyUser(context.get("log"), requestContext.session, {
        maskEmail: true,
      })
    : false;

  context.get("log").set({
    auth: { resolvedIn: Date.now() - startedAt, identified },
  });

  return requestContext;
}

// Expected outcomes reach here too — a duplicate patient is a CONFLICT, not a
// fault. Logging those buries the genuine 500s they outnumber.
function logORPCError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    return;
  }
  console.error(error);
}

const MAX_RPC_BODY_BYTES = 1024 * 1024;

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new BodyLimitPlugin({ maxBodySize: MAX_RPC_BODY_BYTES })],
  interceptors: [onError(logORPCError)],
});

// Before session resolution. The oRPC plugin repeats the limit at the protocol
// adapter boundary for callers mounted elsewhere.
app.use(
  "/rpc/*",
  bodyLimit({
    maxSize: MAX_RPC_BODY_BYTES,
    onError: (c) => c.json({ error: "Request too large" }, 413),
  }),
);
app.use("/rpc/*", async (c) => {
  const context = await createLoggedRequestContext(c);
  const result = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  });

  if (!result.matched) {
    return c.notFound();
  }

  return c.newResponse(result.response.body, result.response);
});

if (!isProduction) {
  const apiHandler = new OpenAPIHandler(appRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
    ],
    interceptors: [onError(logORPCError)],
  });

  app.use("/api-reference/*", async (c) => {
    const context = await createLoggedRequestContext(c);
    const result = await apiHandler.handle(c.req.raw, {
      prefix: "/api-reference",
      context,
    });

    if (!result.matched) {
      return c.notFound();
    }

    return c.newResponse(result.response.body, result.response);
  });
}

// Readiness, not liveness: a process that answers while Postgres is unreachable
// reports healthy through an outage in which every request fails.
app.get("/", async (c) => {
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    console.error("health check failed", error);
    return c.text("UNAVAILABLE", 503);
  }
  return c.text("OK");
});

// Audit writes are fire-and-forget, so a deploy drops whichever are in flight.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void drainAuditWrites()
      .catch((error: unknown) => console.error("audit drain failed", error))
      .finally(() => process.exit(0));
  });
}

export default app;
