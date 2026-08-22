# Request lifecycle

## Entry points

`apps/server/src/index.ts` is the Hono host:

1. evlog request logging and user identification.
2. Credentialed CORS for `CORS_ORIGIN`.
3. `/api/auth/*` for Better Auth.
4. `/rpc/*` for every oRPC procedure.
5. `/api-reference` in development only.

The server builds oRPC context only after a request matches the RPC handler.
The Hono host extracts the request headers and passes them to the
framework-neutral `createRequestContext(headers)` function in
`packages/api/src/lib/context.ts`.
The host reuses that resolved session to identify the request in evlog, so an
RPC request performs one Better Auth session lookup rather than one for logging
and another for authorization. `GET /`, CORS, and auth routes do not
resolve a session through the oRPC context path.
The server-local `createLoggedRequestContext` name reflects that composition:
it creates the API context once and then enriches the request log; it does not
perform a second authentication lookup.

Request bodies are bounded before this context work. Hono rejects `/rpc/*`
bodies above 1 MiB before session resolution, and oRPC repeats the same limit
at its Fetch adapter boundary.

## Context and procedures

`createRequestContext(headers)` builds one context per request. It resolves the
session once, creates one empty membership map, and returns the small shared
`ORPCContext`:

```ts
{
  session;
  headers;
  memberships;
}
```

`orgProcedure(permission, input)` parses the explicit org claim, performs the
indexed membership lookup, checks the role grant, and adds verified scope. The
guard memoizes the membership row in `context.memberships`, keyed by caller and
claimed slug, so a request joins each pair once and later calls in the same
request reuse the result. The map is created per request and never outlives it,
so a removed member is rejected on the next request. An SSR org page whose
parent and child loaders fan out into several procedure calls therefore proves
membership once instead of once per call. The permission check and its denial
audit still run on every call. The permission is a required constructor
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

`apps/web/src/lib/operational-query.ts` owns the polling policy for the three screens
several terminals share: the OPD queue and the two tabs of an OPD appointment — the clinical
view and its billing tab. They refetch every 10 seconds and on window focus, with a
5-second `staleTime` under the 60-second global default. TanStack suppresses the
interval in background tabs, so an idle terminal costs nothing. There are no
websockets or SSE.

When a mutation loses a race, the server answers `CONFLICT` and
`toastOpdConflict` in `apps/web/src/lib/opd-operational-query.ts` invalidates
the queue, the OPD appointment, its pending charges, and its invoices, then toasts the
cross-terminal cause. The loser sees the winner's state rather than an opaque error.

Org pages take `orgSlug` from `/$orgSlug`, pass it in procedure input, and include
it in tenant-specific invalidation keys. oRPC includes procedure input in query
identity, so tenant cache separation requires no second client or custom header.
The dashboard uses one scoped summary procedure with scalar counts rather than
fetching three complete resource lists. That keeps the initial page to one
session lookup, one membership proof, one aggregate data query, and a count-only
response.
