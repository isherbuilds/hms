import { db } from "@hms/db";
import { organization } from "@hms/db/schema/auth";
import { file } from "@hms/db/schema/file";
import { deleteObject, listObjects } from "@hms/storage";
import { and, eq, lt } from "drizzle-orm";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isKeyInOrg(key: string, orgId: string): boolean {
  const segments = key.split("/");

  return (
    segments.length === 3 &&
    segments[0] === orgId &&
    UUID_V7.test(segments[1] ?? "") &&
    Boolean(segments[2])
  );
}

type CleanupResult = {
  staleRows: number;
  orphanObjects: number;
  deleted: number;
  failed: number;
  skipped: number;
};

export async function cleanupUploads(opts: {
  olderThan: Date;
  execute: boolean;
}): Promise<CleanupResult> {
  const result: CleanupResult = {
    staleRows: 0,
    orphanObjects: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
  };

  const organizations = await db.select({ id: organization.id }).from(organization);

  for (const { id: orgId } of organizations) {
    const staleRows = await db
      .select({ id: file.id })
      .from(file)
      .where(
        and(eq(file.orgId, orgId), eq(file.status, "pending"), lt(file.createdAt, opts.olderThan)),
      );

    // A stale row's object is deleted right here; the orphan pass below must not see
    // it again and count the same object twice.
    const handled = new Set<string>();

    for (const { id: key } of staleRows) {
      result.staleRows++;

      if (!isKeyInOrg(key, orgId)) {
        result.skipped++;
        console.info(`[skipped invalid key] ${key}`);
        continue;
      }

      if (!opts.execute) {
        console.info(`[dry-run stale] ${key}`);
        continue;
      }

      const [deletedRow] = await db
        .delete(file)
        .where(and(eq(file.id, key), eq(file.orgId, orgId), eq(file.status, "pending")))
        .returning({ id: file.id });

      if (!deletedRow) {
        result.skipped++;
        console.info(`[skipped finalized] ${key}`);
        continue;
      }

      handled.add(key);

      try {
        await deleteObject(key);
        result.deleted++;
        console.info(`[deleted stale] ${key}`);
      } catch {
        result.failed++;
        console.error(`[failed stale object] ${key}`);
      }
    }

    const existingRows = await db.select({ id: file.id }).from(file).where(eq(file.orgId, orgId));
    const existingKeys = new Set(existingRows.map((row) => row.id));

    for await (const object of listObjects(`${orgId}/`)) {
      if (object.lastModified >= opts.olderThan) {
        continue;
      }

      if (!isKeyInOrg(object.key, orgId)) {
        result.skipped++;
        console.info(`[skipped invalid key] ${object.key}`);
        continue;
      }

      if (existingKeys.has(object.key) || handled.has(object.key)) {
        continue;
      }

      result.orphanObjects++;

      if (!opts.execute) {
        console.info(`[dry-run orphan] ${object.key}`);
        continue;
      }

      try {
        await deleteObject(object.key);
        result.deleted++;
        console.info(`[deleted orphan] ${object.key}`);
      } catch {
        result.failed++;
        console.error(`[failed orphan] ${object.key}`);
      }
    }
  }

  return result;
}
