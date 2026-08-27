# OPD quote prefetch review

## Question

Should the intake automatically prefetch the opposite `omitConsultFee` quote after every successful quote?

## Answer

No, not without a measured latency problem. The current effect adds a second billing quote request for a state the operator may never select. The simpler baseline is to let the existing query run when the omission choice changes. If measurement later shows that toggle latency is material, prefetch from the remove/restore control's focus or pointer interaction.

## Evidence

- The intake's main quote already keys on `omitConsultFee`; changing the boolean naturally requests the authoritative variant (`apps/web/src/components/opd-intake-form.tsx:139`). The added effect waits for that request to settle and then prefetches the inverse variant (`apps/web/src/components/opd-intake-form.tsx:154`).
- TanStack Query documents interaction-driven prefetch as the straightforward pattern when a user indicates likely intent. It also notes that prefetch executes the query and caches its result, so it is real server work rather than a free cache hint. [TanStack Query: Prefetching & Router Integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- React's guidance distinguishes work caused by rendering from work caused by a particular interaction, recommending that interaction-specific work remain in the corresponding handler. [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- This repository gives queries a 60-second default `staleTime`, so an interaction-prefetched variant can still be reused immediately (`apps/web/src/lib/query-client.ts:28`).

## What this proves / does not prove

This proves that removing the automatic inverse prefetch preserves correctness and removes one speculative request per settled quote state. It does not prove that users will never benefit from prefetching, nor does it measure the quote endpoint's latency under production load.

## What this means for us

Delete the effect for the initial implementation. Keep the boolean in the normal query key and preserve the authoritative loading/error UI. Add interaction prefetch only if a trace or usability measurement shows the omit/restore round trip misses an agreed response-time target.

## Next falsification

Measure p50/p95 `opd.quoteWalkIn` latency and observe the omit/restore interaction on representative clinic hardware and network conditions. Reinstate a narrowly event-driven prefetch only if the uncached interaction is visibly slow and the extra request rate is acceptable.

## Sources

- [TanStack Query: Prefetching & Router Integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- `apps/web/src/components/opd-intake-form.tsx:139`
- `apps/web/src/components/opd-intake-form.tsx:154`
- `apps/web/src/lib/query-client.ts:28`
