# 0017: Keep AI streaming as a narrow HTTP exception

- **Status:** accepted
- **Date:** 2026-08-07

## Context

Organization pages normally call the single oRPC surface at `/rpc`. AI chat has
a different transport contract: `POST /ai` accepts AI SDK UI messages, calls
`streamText`, and returns `createUIMessageStreamResponse` directly. The web route
uses AI SDK's `DefaultChatTransport` rather than the oRPC client. Keeping that
native boundary avoids a bespoke adapter between oRPC and the AI SDK UI-message
stream.

The separate route must not become a separate authorization model. It currently
builds the normal request context and calls `authorizeOrg` with the claimed
organization slug and `{ ai: ["use"] }`. Membership is resolved without a cache,
and unauthenticated and unauthorized requests receive equivalent 401 and 403
responses.

## Decision

Sanction `POST /ai` as a narrow, streaming-only exception to the single-`/rpc`
rule. It keeps its explicit `authorizeOrg` call, verified organization scope,
uncached membership lookup, and `{ ai: ["use"] }` grant.

Sending a prompt does not by itself add an audit point. Any future sensitive AI
action must be authorized and audited as that action, independently of this
transport decision.

## Consequences

The current AI SDK streaming response stays native and the exception is visible
and reviewable rather than implied. No other organization operation may use this
ADR to bypass `orgProcedure` or the oRPC client.

Revisit an `ai.stream` oRPC procedure only when its streaming adapter and client
contract can carry the AI SDK UI-message stream without a bespoke bridge. Such a
procedure would still be declared with `orgProcedure({ ai: ["use"] }, input)` and
would preserve the same organization and 401/403 semantics.
