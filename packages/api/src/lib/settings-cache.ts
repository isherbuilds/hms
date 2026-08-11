import { db } from "@hms/db";
import {
  SETTINGS_DEFAULTS,
  organizationSettings,
} from "@hms/db/schema/organization-settings";
import { eq } from "drizzle-orm";

export type OrgSettings = Omit<
  typeof organizationSettings.$inferSelect,
  "orgId" | "createdAt" | "updatedAt"
>;

/**
 * Per-process TTL cache for organization settings, for server-side *derived*
 * reads only (document numbering prefixes, print headers) where a bounded
 * staleness window is acceptable (see ADR 0016).
 *
 * - `settings.update` invalidates the entry, so a same-process write is
 *   visible to the very next read; other instances converge within the TTL.
 * - The TTL is long (one hour) on purpose: these values (legal name, tax id,
 *   numbering prefixes) are set at onboarding and then essentially never
 *   change, and the single write path invalidates. Shorten it before caching
 *   anything a tenant edits routinely.
 * - The admin-facing `settings.get` never uses this cache — the settings page
 *   always shows the stored row.
 * - Membership/authorization is NEVER cached (hard rule); this module must
 *   not grow in that direction.
 */
export const SETTINGS_CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { value: OrgSettings; expiresAt: number }>();

/**
 * `now` exists as a test seam for the expiry contract; production callers
 * never pass it.
 */
export async function readOrgSettings(
  orgId: string,
  now: number = Date.now(),
): Promise<OrgSettings> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const [row] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  let value: OrgSettings;
  if (row) {
    const { orgId: _orgId, createdAt: _c, updatedAt: _u, ...fields } = row;
    value = fields;
  } else {
    // A fresh organization has no row yet; reads never create one. The
    // defaults are cached too — `settings.update` invalidates on first save.
    value = { ...SETTINGS_DEFAULTS };
  }
  cache.set(orgId, { value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
  return value;
}

export function invalidateOrgSettings(orgId: string): void {
  cache.delete(orgId);
}
