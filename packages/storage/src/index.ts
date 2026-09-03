import { env } from "@hms/env/server";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Every object is private and reachable only through a short-lived presigned URL.
// There is deliberately no public path: a bucket policy broad enough to serve
// public files also exposes every tenant's private ones (hard rule 7).

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
      // Otherwise the SDK adds `x-amz-checksum-crc32`, computed over the empty body it
      // has at signing time, and the eventual upload is rejected with `BadDigest`.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  return cached;
}

export function maxUploadBytes(): number {
  return env.SEAWEEDFS_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES;
}

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

export function createReadUrl(key: string): Promise<string> {
  const { bucket, client } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: DEFAULT_EXPIRES_IN,
  });
}

export async function deleteObject(key: string): Promise<void> {
  const { bucket, client } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
