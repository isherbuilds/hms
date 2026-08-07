# File storage

`packages/storage` wraps a SeaweedFS S3 gateway. Two contracts govern it.

## Performance contract: bytes never touch the app server

The app issues **presigned URLs** and the browser talks to SeaweedFS directly
for both upload and download. `deleteObject` is the only server-side data path,
and it is metadata-only. Never add a route that proxies file bytes: it converts
a constant-memory operation into one bounded by request size and concurrency.

## Security contract: every object is private

There is deliberately **no public-object path**. Making one work requires an
anonymously readable bucket, and any policy broad enough to serve "public" files
also exposes every tenant's private ones at a guessable URL. A `visibility`
column with no storage-side counterpart is decoration.

Share links belong in the app, in front of a presign, where they can be scoped
to a tenant, expired, and revoked.

Presigned URLs last 15 minutes and are issued only after an authorization check.
Treat one as a bearer credential: never log it, never put it in audit `meta`.

## Keys

```
<orgId>/<uuid>/<sanitized-name>
```

The org prefix means `assertKeyInScope` can reject a foreign key **before any
database work** — and audit the attempt, because a probe for another tenant's
key is exactly what an audit trail is for. The audit record stores only a
digest of the rejected key: the key is caller-controlled and could be a
presigned URL, i.e. a live bearer credential. The queries still carry the org
predicate as defence in depth; neither check is redundant, because they fail
differently.

`sanitizeKeyName` keeps only `[A-Za-z0-9._-]`, so a user-supplied name can never
produce a nested key (`/`), path traversal (`..`), or break URL building (`%`,
`#`).

## Upload lifecycle

1. `createUpload` — checks the size ceiling, mints the key, presigns a `PUT`,
   and inserts the metadata row as **`pending`**.
2. The browser uploads directly to SeaweedFS.
3. `finalizeUpload` — a scoped `UPDATE ... RETURNING` flipping `pending` →
   `ready`. One round trip, no window between the check and the write.

An abandoned upload stays `pending` and is never listed or readable. `list` and
`getReadUrl` both require `status = "ready"`.

## Deletion ordering

The metadata row is deleted **first**, then the object. Dropping the object
first could leave a `ready` row pointing at nothing. The audit row is written
fire-and-forget right after the committed row delete, so a storage outage can
never sit between a deletion and its record. If `deleteObject` fails, the
surviving object is an orphan whose key nobody can resolve any more — the key
is logged and the caller still sees success, because the deletion itself
committed.

## Configuration

The four `SEAWEEDFS_*` variables are optional; the module throws a named error
listing them when a file operation is attempted without them, so a deployment
that does not use files still boots. `SEAWEEDFS_MAX_UPLOAD_BYTES` defaults to
100 MiB.

Checksum calculation is set to `WHEN_REQUIRED` on purpose. The SDK otherwise
adds `x-amz-checksum-crc32` computed over the empty body it has at _signing_
time, and the eventual upload is rejected with `BadDigest`. Checksums must stay
opt-in for presigned URLs to work at all.
