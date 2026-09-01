import { db } from "@hms/db";
import { SETTINGS_DEFAULTS, organizationSettings } from "@hms/db/schema/organization-settings";
import { eq } from "drizzle-orm";

type OrgSettings = Omit<
  typeof organizationSettings.$inferSelect,
  "orgId" | "createdAt" | "updatedAt"
>;

// Server-side derived reads only (numbering prefixes, print headers), where a
// bounded staleness window is acceptable (D009). Membership is NEVER cached.
export const SETTINGS_CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { value: OrgSettings; expiresAt: number }>();

// `now` is a test seam for the expiry contract; production never passes it.
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
    // The defaults are cached too; `settings.update` invalidates on first save.
    value = { ...SETTINGS_DEFAULTS };
  }
  cache.set(orgId, { value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
  return value;
}

export function invalidateOrgSettings(orgId: string): void {
  cache.delete(orgId);
}
