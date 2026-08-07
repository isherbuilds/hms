# 0006: Stored objects are always private

- **Status:** accepted
- **Date:** 2026-08-05

## Context

Products routinely want "public" files — an avatar, a shared attachment, a
logo — served straight from the bucket without a signature. Implementing that
requires a bucket policy allowing anonymous reads on some prefix.

The problem is that the bucket holds every tenant's data. Any anonymous-read
policy broad enough to serve public objects is enforced by the storage layer,
which knows nothing about tenancy; and keys are guessable enough that a policy
mistake is not theoretical. A `visibility` column in the database with no
storage-side counterpart is decoration — it changes what the app shows, not what
the bucket serves.

## Decision

`@better-stack/storage` issues only short-lived presigned URLs. There is no
unsigned read path, and the bucket must never be anonymously readable.

Bytes never pass through the app server either: the browser uploads and
downloads directly against the S3 gateway, and `deleteObject` is the only
server-side data path.

Share links belong in the app, in front of a presign, where they can be scoped
to a tenant, expired, and revoked.

## Consequences

Every read costs a round trip to get a URL, and the URL expires in 15 minutes.
Long-lived `<img src>` references to stored objects do not work without
re-presigning; that is the intended constraint, not an oversight.

A presigned URL is a bearer credential for its lifetime — never log one, never
put one in audit `meta`.

Because no route proxies file bytes, upload throughput is not bounded by app
server memory or concurrency. Adding such a route would quietly reverse that.

Revisit only with a per-tenant bucket or a CDN that can enforce tenant-scoped
signed access; a policy change alone is never sufficient.
