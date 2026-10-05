import { db } from "@hms/db";
import { invoices } from "@hms/db/schema/invoices";
import { SETTINGS_DEFAULTS, organizationSettings } from "@hms/db/schema/organization-settings";
import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { invalidateOrgSettings } from "../lib/settings-cache";
import { type SettingsFields, settingsFields, settingsRules } from "../lib/settings-schema";

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

  update: orgProcedure(
    { settings: ["update"] },
    orgInput.extend(settingsFields.shape).superRefine(settingsRules),
  ).handler(async ({ context, input }): Promise<SettingsFields> => {
    const { scope } = context;
    const { orgSlug: _claim, ...fields } = input;
    const { currency, ...mutableFields } = fields;

    const [current] = await db
      .select({
        currency: organizationSettings.currency,
        invoicePrefix: organizationSettings.invoicePrefix,
        pharmacyInvoicePrefix: organizationSettings.pharmacyInvoicePrefix,
      })
      .from(organizationSettings)
      .where(eq(organizationSettings.orgId, scope.orgId))
      .limit(1);

    const stored = current ?? SETTINGS_DEFAULTS;

    // Fail loud (D028): a differing currency is a config error, never a silent drop.
    if (currency !== stored.currency) {
      throw new ORPCError("CONFLICT", {
        message: "Currency cannot be changed for this organization",
      });
    }

    // The streams count independently over one number index, so moving a prefix to the
    // other stream recreates a number it already issued. An issued prefix is final.
    const issued = async (stream: "opd" | "pharmacy") => {
      const [row] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.stream, stream)))
        .limit(1);

      return row !== undefined;
    };

    if (fields.invoicePrefix !== stored.invoicePrefix && (await issued("opd"))) {
      throw new ORPCError("CONFLICT", {
        message: "The invoice prefix cannot change once an invoice has been issued",
      });
    }

    if (
      fields.pharmacyInvoicePrefix !== stored.pharmacyInvoicePrefix &&
      (await issued("pharmacy"))
    ) {
      throw new ORPCError("CONFLICT", {
        message: "The pharmacy invoice prefix cannot change once a sale has been invoiced",
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
  }),
};
