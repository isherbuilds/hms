import { auth } from "@hms/auth";
import { env } from "@hms/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { appRouter, type AppRouter } from "@hms/api/routers/index";

const getORPCClient = createIsomorphicFn()
  .server((): RouterClient<AppRouter> =>
    createRouterClient(appRouter, {
      context: async () => {
        const headers = new Headers(getRequestHeaders());
        const session = await auth.api.getSession({ headers });

        return { headers, session };
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
