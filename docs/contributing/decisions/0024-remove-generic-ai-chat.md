# 0024: Remove generic AI chat until it belongs to an owned workflow

- **Status:** accepted
- **Date:** 2026-08-21
- **Supersedes:** [0017](./0017-ai-streaming-http-surface.md)

## Context

The application exposed a general organization chat at `/$orgSlug/ai` backed by
a streaming `POST /ai` endpoint. Its tenancy and transport controls were sound,
but the feature had no owned hospital workflow, source-record linkage, consent
boundary, provenance record, or required human review. The product blueprint
permits AI assistance only when those workflow controls exist.

Keeping a generic chat live would make a model playground look like an accepted
clinical capability. Keeping its route, permission, provider configuration, or
speculative charge provenance columns after hiding the navigation would leave a
dormant compatibility surface with no current owner.

## Decision

Remove the generic chat route, streaming endpoint, `ai:use` permission, provider
configuration, client and server AI dependencies, and unused AI charge fields.
There is no redirect or compatibility alias for the deleted route.

AI returns only as part of a separately accepted, evidence-backed hospital
workflow. That decision must define authorization, consent, provenance, human
review, source-record linkage, failure handling, and auditing before code ships.
Its transport follows the workflow's needs; ADR 0017 does not reserve `/ai`.

## Consequences

The current product has no AI destination or model-provider secret. Operators
cannot mistake free-form generated text for a clinical record or approved
decision aid, and the dependency/runtime surface stays proportional to shipped
work.

Future AI work is a new vertical slice, not restoration of the removed chat. It
must earn its data model, permission, route, and provider configuration from the
accepted workflow.
