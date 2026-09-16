import { db } from "@hms/db";
import { SETTINGS_DEFAULTS, organizationSettings } from "@hms/db/schema/organization-settings";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { invalidateOrgSettings } from "../lib/settings-cache";

// Time zones are validated by probing the formatter: Bun's JavaScriptCore lists
// only legacy canonical ids (Asia/Calcutta), so a membership check would reject
// Asia/Kolkata — the default the migration backfills.
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

const settingsFields = z.object({
  legalName: z.string().trim().max(200),
  address: z.string().trim().max(500),
  taxId: z.string().trim().max(50),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code"),
  timeZone: z.string().refine(isSupportedTimeZone, {
    message: "Use a valid IANA time zone like Asia/Kolkata",
  }),
  mrnPrefix: z.string().trim().max(10),
  invoicePrefix: z.string().trim().max(10),
  receiptPrefix: z.string().trim().max(10),
  advanceReceiptPrefix: z.string().trim().max(10),
  creditNotePrefix: z.string().trim().max(10),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  followUpValidityDays: z.number().int().min(1).max(365),
  unbilledAlertHours: z.number().int().min(1).max(168),
});

export type SettingsFields = z.infer<typeof settingsFields>;

export const settingsRouter = {
  get: orgProcedure({ settings: ["read"] }, orgInput).handler(
    async ({ context }): Promise<SettingsFields> => {
      const [row] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, context.scope.orgId))
        .limit(1);

      if (!row) {
        return { ...SETTINGS_DEFAULTS };
      }

      const { orgId: _orgId, createdAt: _c, updatedAt: _u, ...fields } = row;

      return fields;
    },
  ),

  update: orgProcedure({ settings: ["update"] }, orgInput.extend(settingsFields.shape)).handler(
    async ({ context, input }): Promise<SettingsFields> => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;
      const { currency, ...mutableFields } = fields;

      const [current] = await db
        .select({ currency: organizationSettings.currency })
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, scope.orgId))
        .limit(1);

      // Fail loud (D028): a differing currency is a config error, never a silent drop.
      if (currency !== (current?.currency ?? SETTINGS_DEFAULTS.currency)) {
        throw new ORPCError("CONFLICT", {
          message: "Currency cannot be changed for this organization",
        });
      }

      // A later time-zone change re-derives future dates only; written rows keep the
      // business date they were numbered under. The check above is sufficient: no
      // write path ever changes a stored currency, so the upsert needs no guard.
      const [row] = await db
        .insert(organizationSettings)
        .values({ ...fields, orgId: scope.orgId })
        .onConflictDoUpdate({
          target: organizationSettings.orgId,
          set: { ...mutableFields, updatedAt: new Date() },
        })
        .returning();

      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to save settings" });
      }

      // Derived reads must see the new prefixes on the next call in this process.
      invalidateOrgSettings(scope.orgId);

      audit({
        action: "settings.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `settings:${scope.orgId}`,
      });

      const { orgId: _orgId, createdAt: _c, updatedAt: _u, ...saved } = row;

      return saved;
    },
  ),
};
