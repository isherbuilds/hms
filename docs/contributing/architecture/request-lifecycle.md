# Request lifecycle

## Entry points

`apps/server/src/index.ts` is the Hono host:

1. evlog request logging and user identification.
2. Credentialed CORS for `CORS_ORIGIN`.
3. `/api/auth/*` for Better Auth.
4. `/rpc/*` for every oRPC procedure.
5. `/api-reference` in development only.
6. `/ai` for the streaming AI route, guarded by explicit org input and the
   shared authorization resolver.

The server builds oRPC context only after a request matches the RPC handler.
`packages/api/src/lib/context.ts` is the Hono adapter; it
accepts the Hono context so host call sites do not manually extract headers.
The host reuses that resolved session to identify the request in evlog, so an
RPC request performs one Better Auth session lookup rather than one for logging
and another for authorization. `GET /`, CORS, and auth routes do not
resolve a session through the oRPC context path.
The server-local `createLoggedRequestContext` name reflects that composition:
it creates the API context once and then enriches the request log; it does not
perform a second authentication lookup.

AI SDK devtools are loaded only for non-production AI requests. The middleware
creates request-specific trace state and rejects production use, so it remains
inside the request while its package is omitted from the production hot path.

## Context and procedures

The framework adapter resolves the session and returns the small shared
`ORPCContext`:

```ts
{
  session;
  headers;
}
```

`orgProcedure(permission, input)` parses the explicit org claim, performs the
indexed membership lookup, checks the role grant, and adds verified scope. The
lookup is fresh for every request. The permission is a required constructor
argument and the raw oRPC builder is not exported, so the guard cannot be
omitted. `headers` lets org procedures call Better Auth as the authenticated
caller.

```text
orgProcedure(permission, orgInput...) → parses the caller's org claim
                                       → session + membership + role grant,
                                         else 401/403
                                       → adds { scope: { userId, orgId } }
```

Handlers use `context.scope`, never the input claim, and keep the org predicate
in every query.

## Web client

`apps/web/src/lib/orpc.ts` owns one oRPC client and one set of TanStack Query
utilities. Web routes import that concrete module directly:

- browser calls `${VITE_SERVER_URL}/rpc` with credentials;
- SSR calls the router in-process with request headers;
- org procedures use the same client.

The landing-page transport check calls the public `GET /` endpoint directly;
it is not an oRPC procedure and therefore does not resolve a session.

`apps/web/src/lib/query-client.ts` owns QueryClient policy. The TanStack router
creates one QueryClient per router instance, which means one for the browser app
and a fresh instance for each SSR router. Queries do not retry during SSR or
after `401`/`403`; other browser failures retry at most twice. Stale queries
retain TanStack Query's mount, focus, and reconnect revalidation.

Org pages take `orgSlug` from `/org/$orgSlug`, pass it in procedure input, and include
it in tenant-specific invalidation keys. oRPC includes procedure input in query
identity, so tenant cache separation requires no second client or custom header.
The dashboard uses one scoped summary procedure with scalar counts rather than
fetching three complete resource lists. That keeps the initial page to one
session lookup, one membership proof, one aggregate data query, and a count-only
response.
