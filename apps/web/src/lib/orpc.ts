import { env } from "@hms/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createRequestContext, type ORPCContext } from "@hms/api/lib/context";
import { appRouter, type AppRouter } from "@hms/api/routers/index";

/**
 * oRPC calls the context factory once per procedure call, so a server-rendered
 * page that fans out into several calls would otherwise resolve the session and
 * re-prove membership once per call. Keying on the request object bounds the
 * cache to exactly one request: TanStack Start holds one `H3Event` per request
 * in AsyncLocalStorage and `getRequest()` returns that event's `Request`, so the
 * identity is stable for the whole request and distinct across requests. A
 * `WeakMap` lets the entry be reclaimed once the request is collected, so
 * nothing — session or membership — survives into a later request.
 */
const contextByRequest = new WeakMap<Request, Promise<ORPCContext>>();

const getORPCClient = createIsomorphicFn()
  .server((): RouterClient<AppRouter> =>
    createRouterClient(appRouter, {
      context: () => {
        const request = getRequest();
        const cached = contextByRequest.get(request);
        if (cached) return cached;

        const context = createRequestContext(new Headers(request.headers));
        contextByRequest.set(request, context);

        return context;
      },
    }),
  )
  .client((): RouterClient<AppRouter> => {
    const link = new RPCLink({
      url: `${env.VITE_SERVER_URL}/rpc`,
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
    });

    return createORPCClient(link);
  });

const client = getORPCClient();
export const orpc = createTanstackQueryUtils(client);
