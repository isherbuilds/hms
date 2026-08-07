import { env } from "@better-stack/env/server";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * SeaweedFS storage client.
 *
 * Performance contract: large objects never pass through the app server. The
 * app only ever returns presigned URLs and lets the browser talk to the
 * SeaweedFS S3 gateway directly (upload and download). `deleteObject` is the
 * only server-side data path, and it is a metadata-only operation.
 *
 * Security contract: **every** object is private and reachable only through a
 * short-lived presigned URL. There is deliberately no "public object" path —
 * making one work requires an anonymously readable bucket, and any such policy
 * broad enough to serve public files would also expose every tenant's private
 * files at a guessable URL. Share links belong in the app, in front of a
 * presign, where they can be scoped and revoked.
 */

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_EXPIRES_IN = 15 * 60;

let cached: { bucket: string; client: S3Client } | null = null;

function storage() {
  if (cached) {
    return cached;
  }
  const { SEAWEEDFS_ENDPOINT, SEAWEEDFS_BUCKET, SEAWEEDFS_ACCESS_KEY_ID } = env;
  const secretAccessKey = env.SEAWEEDFS_SECRET_ACCESS_KEY;
  if (!SEAWEEDFS_ENDPOINT || !SEAWEEDFS_BUCKET || !SEAWEEDFS_ACCESS_KEY_ID || !secretAccessKey) {
    throw new Error(
      "SeaweedFS is not configured. Set SEAWEEDFS_ENDPOINT, SEAWEEDFS_BUCKET, " +
        "SEAWEEDFS_ACCESS_KEY_ID and SEAWEEDFS_SECRET_ACCESS_KEY.",
    );
  }
  cached = {
    bucket: SEAWEEDFS_BUCKET,
    client: new S3Client({
      endpoint: SEAWEEDFS_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: SEAWEEDFS_ACCESS_KEY_ID, secretAccessKey },
      // The SDK otherwise adds `x-amz-checksum-crc32` to every request. When
      // *presigning*, it computes that over the empty body it has at signing
      // time, so the eventual upload is rejected with `BadDigest`
      // ("expected AAAAAA==", the CRC32 of nothing). Checksums must stay opt-in
      // for presigned URLs to work at all.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  return cached;
}

export function maxUploadBytes(): number {
  return env.SEAWEEDFS_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES;
}

export const uploadExpiresIn = DEFAULT_EXPIRES_IN;

/**
 * Returns a short-lived presigned PUT URL. The browser streams the file
 * straight to SeaweedFS — no bytes cross the app server.
 */
export function createUploadUrl(
  key: string,
  options: { contentType?: string; size: number },
): Promise<string> {
  const { bucket, client } = storage();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.size,
    }),
    { expiresIn: DEFAULT_EXPIRES_IN },
  );
}

/** Returns a short-lived presigned GET URL. Use after an access-control check. */
export function createReadUrl(key: string): Promise<string> {
  const { bucket, client } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: DEFAULT_EXPIRES_IN,
  });
}

/** Deletes an object server-side. Metadata-only, no data transfer to the app. */
export async function deleteObject(key: string): Promise<void> {
  const { bucket, client } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
