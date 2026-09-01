import { env } from "@hms/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createRequestContext, type ORPCContext } from "@hms/api/lib/context";
import { appRouter, type AppRouter } from "@hms/api/routers/index";

// Keyed on the request object, which bounds the cache to exactly one request:
// TanStack Start returns that request's `Request` for its whole lifetime. A WeakMap
// lets it be reclaimed, so no session or membership survives into a later request.
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
