import { db } from "@better-stack/db";
import {
  SETTINGS_DEFAULTS,
  organizationSettings,
} from "@better-stack/db/schema/organization-settings";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, publicProcedure, requirePermission } from "../lib/procedures/factory";

/**
 * The full settings row is validated and written as one unit — there is no
 * partial update, so a saved row never mixes stored and default values.
 */
const settingsFields = z.object({
  legalName: z.string().trim().max(200),
  address: z.string().trim().max(500),
  taxId: z.string().trim().max(50),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code"),
  mrnPrefix: z.string().trim().max(10),
  invoicePrefix: z.string().trim().max(10),
  receiptPrefix: z.string().trim().max(10),
  creditNotePrefix: z.string().trim().max(10),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});

export type SettingsFields = z.infer<typeof settingsFields>;

export const settingsRouter = {
  get: publicProcedure
    .input(orgInput)
    .use(requirePermission({ settings: ["read"] }))
    .handler(async ({ context }): Promise<SettingsFields> => {
      const [row] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, context.scope.orgId))
        .limit(1);

      // A fresh organization has no row yet; reads never create one.
      if (!row) {
        return { ...SETTINGS_DEFAULTS };
      }
      const { orgId: _orgId, createdAt: _c, updatedAt: _u, ...fields } = row;
      return fields;
    }),

  update: publicProcedure
    .input(orgInput.extend(settingsFields.shape))
    .use(requirePermission({ settings: ["update"] }))
    .handler(async ({ context, input }): Promise<SettingsFields> => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;

      const [row] = await db
        .insert(organizationSettings)
        .values({ ...fields, orgId: scope.orgId })
        .onConflictDoUpdate({
          target: organizationSettings.orgId,
          set: { ...fields, updatedAt: new Date() },
        })
        .returning();

      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to save settings" });
      }

      // Tax identity and numbering prefixes shape every printed invoice —
      // a sensitive success, recorded fire-and-forget.
      audit({
        action: "settings.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `settings:${scope.orgId}`,
      });

      const { orgId: _orgId, createdAt: _c, updatedAt: _u, ...saved } = row;
      return saved;
    }),
};
