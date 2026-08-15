import { google } from "@ai-sdk/google";
import { drainAuditWrites } from "@hms/api/audit";
import { createContext, type ORPCContext } from "@hms/api/lib/context";
import { authorizeOrg } from "@hms/api/lib/procedures/factory";
import { appRouter } from "@hms/api/routers/index";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { env } from "@hms/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { sql } from "drizzle-orm";
import {
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  convertToModelMessages,
  wrapLanguageModel,
} from "ai";
import { initLogger } from "evlog";
import { createAILogger, createEvlogIntegration } from "evlog/ai";
import { identifyUser } from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono, type Context as HonoContext } from "hono";
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
    // Cache preflight responses so cross-origin RPCs don't pay an OPTIONS
    // round trip per endpoint per navigation.
    maxAge: 86400,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function createLoggedRequestContext(
  context: HonoContext<EvlogVariables>,
): Promise<ORPCContext> {
  const startedAt = Date.now();
  const requestContext = await createContext({ context });
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

/**
 * Expected outcomes reach here too — a duplicate patient is a `CONFLICT`, not a
 * fault. Logging those buries the genuine 500s they outnumber.
 */
function logORPCError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    return;
  }
  console.error(error);
}

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [onError(logORPCError)],
});

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

// Every token is billed, so the conversation a member can submit is bounded.
const MAX_AI_MESSAGES = 50;
const MAX_AI_CHARS = 100_000;

app.post("/ai", async (c) => {
  const body = await c.req.json<{ orgSlug?: unknown; messages?: unknown }>();
  if (
    typeof body.orgSlug !== "string" ||
    body.orgSlug.length === 0 ||
    !Array.isArray(body.messages)
  ) {
    return c.json({ error: "Invalid request" }, 400);
  }

  if (
    body.messages.length > MAX_AI_MESSAGES ||
    JSON.stringify(body.messages).length > MAX_AI_CHARS
  ) {
    return c.json({ error: "Conversation too large" }, 413);
  }

  const context = await createLoggedRequestContext(c);
  try {
    await authorizeOrg(context, body.orgSlug, { ai: ["use"] });
  } catch (error) {
    if (error instanceof ORPCError && error.code === "UNAUTHORIZED") {
      return c.json({ error: error.code }, 401);
    }
    if (error instanceof ORPCError && error.code === "FORBIDDEN") {
      return c.json({ error: error.code }, 403);
    }
    throw error;
  }

  const uiMessages = body.messages;
  const ai = createAILogger(c.get("log"));
  const baseModel = google("gemini-2.5-flash");
  const model = isProduction
    ? baseModel
    : wrapLanguageModel({
        model: baseModel,
        middleware: (await import("@ai-sdk/devtools")).devToolsMiddleware(),
      });
  const result = streamText({
    model: ai.wrap(model),
    messages: await convertToModelMessages(uiMessages),
    telemetry: {
      isEnabled: true,
      integrations: [createEvlogIntegration(ai)],
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});

/**
 * Readiness, not liveness: a process that answers while Postgres is unreachable
 * reports healthy through an outage in which every request fails.
 */
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
