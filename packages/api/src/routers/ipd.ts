import { authorize } from "@hms/auth/access";
import { db } from "@hms/db";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { nextCounter } from "@hms/db/counter";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import {
  ACTIVE_ADMISSION_STATUSES,
  DISCHARGE_TYPES,
  ENDED_ADMISSION_STATUSES,
  admissionBedStays,
  admissionPharmacyIssues,
  admissions,
  bedCategories,
  bedReservations,
  bedTariffLines,
  bedTariffs,
  beds,
  wards,
  type AdmissionStatus,
} from "@hms/db/schema/ipd";
import { guardianLabel } from "@hms/db/schema/patient-relations";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { formatDecimal } from "../core/money";
import {
  bumpChargeRevision,
  expectedChargeRevision,
  lockAdmissionCharges,
  requireChargeable,
} from "../lib/admission-charges";
import {
  billingDocumentContext,
  issueInvoiceTx,
  settleIssuedInvoiceTx,
} from "../lib/billing-documents";
import { advanceRemaining, readDepositsHeld } from "../lib/advance-credit";
import { impossible } from "../lib/conflict";
import {
  exclusionViolationConstraint,
  nameConflict,
  uniqueViolationConstraint,
} from "../lib/db-errors";
import {
  assertUnoccupied,
  auditDisruptions,
  auditReservation,
  BACKDATE_TOLERANCE_MS,
  clearHoldsForOccupancy,
  liveHolds,
  lockBeds,
  requireInScope,
} from "../lib/ipd-beds";
import {
  billAdmissionSelection,
  LAST_DAY_CHOICES,
  readBedDayBill,
  readPendingBill,
  readRunningBills,
  requireBilledDaysKept,
} from "../lib/ipd-bill";
import { requireUnderCashLimit } from "../lib/ipd-cash";
import { orgInput, orgProcedure, requirePermission, type Scope } from "../lib/procedures/factory";
import { money, pageLimit, paymentLine, reason, shortName } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";
import {
  boardHolds,
  ipdReservationsRouter,
  lockHoldForArrival,
  markConverted,
} from "./ipd-reservations";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const AWAITING_CLEANING = "Awaiting cleaning after discharge";

type Effective = { at: Date; backdated: boolean };

function effectiveTime(scope: Scope, requested: Date | undefined, why: string | undefined) {
  const now = new Date();
  const at = requested ?? now;

  if (at.getTime() > now.getTime()) {
    throw new ORPCError("BAD_REQUEST", { message: "That time is in the future." });
  }

  // Older than the tolerance is a correction: it needs `ipd:correct`, a reason, and an audit.
  const backdated = now.getTime() - at.getTime() > BACKDATE_TOLERANCE_MS;

  if (backdated) {
    requirePermission(scope, { ipd: ["correct"] });

    if (!why) {
      throw new ORPCError("BAD_REQUEST", { message: "Give a reason for the earlier time." });
    }
  }

  return { at, backdated } satisfies Effective;
}

const effectiveInput = {
  effectiveAt: z.date().optional(),
  reason: reason.optional(),
};

const admissionSelection = {
  id: admissions.id,
  admissionNumber: admissions.admissionNumber,
  patientId: admissions.patientId,
  practitionerId: admissions.practitionerId,
  status: admissions.status,
  admittedAt: admissions.admittedAt,
  readyAt: admissions.readyAt,
  dischargedAt: admissions.dischargedAt,
  cancelledAt: admissions.cancelledAt,
  cancelReason: admissions.cancelReason,
  attendantName: admissions.attendantName,
  attendantPhone: admissions.attendantPhone,
  medicoLegal: admissions.medicoLegal,
  medicoLegalRef: admissions.medicoLegalRef,
  diagnosis: admissions.diagnosis,
  dischargeType: admissions.dischargeType,
  checkoutMinutes: admissions.checkoutMinutes,
  bedDaysBilled: admissions.bedDaysBilled,
  revision: admissions.revision,
  chargeRevision: admissions.chargeRevision,
};

type AdmissionRow = {
  [K in keyof typeof admissionSelection]: (typeof admissions.$inferSelect)[K];
};

function admissionView(row: AdmissionRow, currentBedId: string | null) {
  return { ...row, currentBedId };
}

async function lockAdmission(tx: Tx, orgId: string, admissionId: string, expectedRevision: number) {
  const [row] = await tx
    .select(admissionSelection)
    .from(admissions)
    .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admissionId)))
    .limit(1)
    .for("update");

  // Missing and stale collapse into one CONFLICT (D026): the terminal refetches.
  if (!row || row.revision !== expectedRevision) {
    throw new ORPCError("CONFLICT", {
      message: "This admission changed on another screen. Refresh and try again.",
    });
  }

  return row;
}

function requireStatus(row: AdmissionRow, allowed: readonly AdmissionStatus[], message: string) {
  if (!allowed.includes(row.status)) {
    throw new ORPCError("CONFLICT", { message });
  }
}

async function openStay(tx: Tx, orgId: string, admissionId: string) {
  const [stay] = await tx
    .select({
      id: admissionBedStays.id,
      bedId: admissionBedStays.bedId,
      startedAt: admissionBedStays.startedAt,
    })
    .from(admissionBedStays)
    .where(
      and(
        eq(admissionBedStays.orgId, orgId),
        eq(admissionBedStays.admissionId, admissionId),
        isNull(admissionBedStays.endedAt),
      ),
    )
    .limit(1);

  if (!stay) {
    throw impossible(`active admission ${admissionId} has no open stay`);
  }

  return stay;
}

function requireNotBeforeStay(at: Date, stay: { startedAt: Date }) {
  if (at.getTime() < stay.startedAt.getTime()) {
    throw new ORPCError("BAD_REQUEST", {
      message: "That time is before the Patient moved into the current bed.",
    });
  }
}

// The destination must be configured for use and free from `from` onwards, counting
// historical stays of Admissions that were not cancelled as errors.
async function assertBedFree(
  tx: Tx,
  orgId: string,
  bed: { id: string; active: boolean; blockedAt: Date | null },
  from: Date,
) {
  if (!bed.active) {
    throw new ORPCError("CONFLICT", { message: "That bed is not in use." });
  }

  if (bed.blockedAt) {
    throw new ORPCError("CONFLICT", { message: "That bed is blocked until it is released." });
  }

  const [clash] = await tx
    .select({ endedAt: admissionBedStays.endedAt })
    .from(admissionBedStays)
    .innerJoin(
      admissions,
      and(
        eq(admissions.orgId, admissionBedStays.orgId),
        eq(admissions.id, admissionBedStays.admissionId),
      ),
    )
    .where(
      and(
        eq(admissionBedStays.orgId, orgId),
        eq(admissionBedStays.bedId, bed.id),
        ne(admissions.status, "cancelled"),
        or(isNull(admissionBedStays.endedAt), gt(admissionBedStays.endedAt, from)),
      ),
    )
    // An open stay wins, so a bed that is occupied now always says so.
    .orderBy(sql`${admissionBedStays.endedAt} asc nulls first`, asc(admissionBedStays.startedAt))
    .limit(1);

  if (clash?.endedAt === null) {
    throw new ORPCError("CONFLICT", { message: "That bed is occupied." });
  }

  // A closed stay clashes only with a typed earlier time, which the operator corrects.
  if (clash) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Another Patient was in that bed at that time.",
    });
  }
}

async function tariffAt(tx: Tx, orgId: string, categoryId: string, at: Date) {
  const [tariff] = await tx
    .select({ id: bedTariffs.id })
    .from(bedTariffs)
    .where(
      and(
        eq(bedTariffs.orgId, orgId),
        eq(bedTariffs.categoryId, categoryId),
        lte(bedTariffs.effectiveFrom, at),
      ),
    )
    .orderBy(desc(bedTariffs.effectiveFrom), desc(bedTariffs.id))
    .limit(1);

  if (!tariff) {
    throw new ORPCError("CONFLICT", {
      message: "That bed's category has no tariff for that time.",
    });
  }

  return tariff;
}

// The database backs the occupancy checks: an active stay per Patient is a unique
// index, overlapping stay intervals are exclusion constraints.
function occupancyConflict(error: unknown): never {
  const constraint = uniqueViolationConstraint(error);

  if (constraint !== undefined) {
    throw new ORPCError("CONFLICT", {
      message:
        constraint === "admissions_org_patient_active_uq"
          ? "This Patient is already admitted."
          : "That bed was just taken on another screen.",
    });
  }

  if (exclusionViolationConstraint(error) !== undefined) {
    throw new ORPCError("CONFLICT", { message: "That bed was just taken on another screen." });
  }

  throw error;
}

function auditBackdate(
  scope: Scope,
  action: string,
  admissionId: string,
  effective: Effective,
  why?: string,
  reservationId?: string,
) {
  if (!effective.backdated) return;

  audit({
    action,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `admission:${admissionId}`,
    meta: { effectiveAt: effective.at.toISOString(), reason: why, reservationId },
  });
}

// Moving a Patient into a held bed disrupts its holds; only `ipd:correct` may do so.
const displaceInput = { displace: z.object({ reason }).optional() };

function requireDisplaceGrant(scope: Scope, displace: { reason: string } | undefined) {
  if (displace) requirePermission(scope, { ipd: ["correct"] });
}

// Each category's rate in force now: one row per category that can price a bed.
function currentTariffs(orgId: string) {
  return db
    .selectDistinctOn([bedTariffs.categoryId], {
      id: bedTariffs.id,
      categoryId: bedTariffs.categoryId,
      effectiveFrom: bedTariffs.effectiveFrom,
    })
    .from(bedTariffs)
    .where(and(eq(bedTariffs.orgId, orgId), lte(bedTariffs.effectiveFrom, new Date())))
    .orderBy(bedTariffs.categoryId, desc(bedTariffs.effectiveFrom), desc(bedTariffs.id));
}

// The rates in force now with their daily lines, in billing order.
function currentTariffLines(orgId: string) {
  const current = currentTariffs(orgId).as("current_tariffs");

  return db
    .select({
      tariffId: current.id,
      categoryId: current.categoryId,
      effectiveFrom: current.effectiveFrom,
      catalogItemId: bedTariffLines.catalogItemId,
      serviceName: catalogItems.name,
      dailyPrice: bedTariffLines.dailyPrice,
      taxRatePercent: catalogItems.taxRatePercent,
    })
    .from(current)
    .innerJoin(
      bedTariffLines,
      and(eq(bedTariffLines.orgId, orgId), eq(bedTariffLines.tariffId, current.id)),
    )
    .innerJoin(
      catalogItems,
      and(eq(catalogItems.orgId, orgId), eq(catalogItems.id, bedTariffLines.catalogItemId)),
    )
    .orderBy(asc(bedTariffLines.position));
}

const transitionInput = orgInput.extend({
  admissionId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
});

// Trimmed; an empty answer is stored as no answer.
const stayText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const stayFacts = {
  attendantName: stayText(200),
  attendantPhone: stayText(20),
  medicoLegalRef: stayText(200),
  diagnosis: stayText(500),
};

const MEDICO_LEGAL_REF_NEEDS_FLAG = "A medico-legal reference needs the medico-legal flag.";

// A discharge recorded in error may be undone for this long.
const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1_000;

const ADMISSION_STATES = {
  current: ACTIVE_ADMISSION_STATUSES,
  past: ENDED_ADMISSION_STATUSES,
} as const;

export const ipdRouter = {
  ...ipdReservationsRouter,
  facility: orgProcedure({ ipd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const [wardRows, categoryRows, bedRows, tariffRows] = await Promise.all([
      db
        .select({ id: wards.id, name: wards.name })
        .from(wards)
        .where(eq(wards.orgId, orgId))
        .orderBy(asc(wards.name)),
      db
        .select({ id: bedCategories.id, name: bedCategories.name })
        .from(bedCategories)
        .where(eq(bedCategories.orgId, orgId))
        .orderBy(asc(bedCategories.name)),
      db
        .select({
          id: beds.id,
          label: beds.label,
          wardId: beds.wardId,
          categoryId: beds.categoryId,
          active: beds.active,
          blockedAt: beds.blockedAt,
          blockedReason: beds.blockedReason,
        })
        .from(beds)
        .where(eq(beds.orgId, orgId))
        .orderBy(asc(beds.label)),
      currentTariffLines(orgId),
    ]);

    type CurrentTariff = {
      id: string;
      effectiveFrom: Date;
      lines: {
        catalogItemId: string;
        serviceName: string;
        dailyPrice: bigint;
        taxRatePercent: string;
      }[];
    };

    const currentTariff = new Map<string, CurrentTariff>();

    for (const { tariffId, categoryId, effectiveFrom, ...line } of tariffRows) {
      const tariff = currentTariff.get(categoryId) ?? { id: tariffId, effectiveFrom, lines: [] };
      tariff.lines.push(line);
      currentTariff.set(categoryId, tariff);
    }

    return {
      wards: wardRows,
      categories: categoryRows.map((category) => ({
        ...category,
        currentTariff: currentTariff.get(category.id) ?? null,
      })),
      beds: bedRows,
    };
  }),

  createWard: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ name: shortName }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const ward = await db
      .insert(wards)
      .values({ id: Bun.randomUUIDv7(), orgId: scope.orgId, name: input.name })
      .returning({ id: wards.id, name: wards.name })
      .then(([row]) => row!)
      .catch((error: unknown) => nameConflict(error, "A ward with this name"));

    audit({
      action: "ipd.ward.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `ward:${ward.id}`,
      meta: { name: ward.name },
    });

    return ward;
  }),

  createBedCategory: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ name: shortName }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const category = await db
      .insert(bedCategories)
      .values({ id: Bun.randomUUIDv7(), orgId: scope.orgId, name: input.name })
      .returning({ id: bedCategories.id, name: bedCategories.name })
      .then(([row]) => row!)
      .catch((error: unknown) => nameConflict(error, "A bed category with this name"));

    audit({
      action: "ipd.bedCategory.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed_category:${category.id}`,
      meta: { name: category.name },
    });

    return category;
  }),

  setBedTariff: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({
      categoryId: z.string(),
      effectiveFrom: z.date(),
      // Billed in this order: the room first, then nursing or similar daily lines.
      lines: z
        .array(z.object({ catalogItemId: z.string(), dailyPrice: money }))
        .min(1)
        .max(10)
        .refine(
          (lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length,
          "List each service once.",
        ),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const itemIds = input.lines.map((line) => line.catalogItemId);

    const [, items, settings] = await Promise.all([
      requireInScope(
        db
          .select({ id: bedCategories.id })
          .from(bedCategories)
          .where(and(eq(bedCategories.orgId, scope.orgId), eq(bedCategories.id, input.categoryId)))
          .limit(1),
        "That bed category no longer exists.",
      ),
      db
        .select({ id: catalogItems.id, taxRatePercent: catalogItems.taxRatePercent })
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.orgId, scope.orgId),
            inArray(catalogItems.id, itemIds),
            eq(catalogItems.active, true),
          ),
        ),
      readOrgSettings(scope.orgId),
    ]);

    if (items.length !== itemIds.length) {
      throw new ORPCError("NOT_FOUND", { message: "That service no longer exists." });
    }

    // No GSTIN, no GST (D063), as for services posted to a stay.
    if (!settings.gstin && items.some((item) => Number(item.taxRatePercent) > 0)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This hospital has no GSTIN, so a daily charge cannot carry GST. Set the service to 0% GST first.",
      });
    }

    const id = Bun.randomUUIDv7();

    await db
      .transaction(async (tx) => {
        // The category lock serialises its rate writers, so two rates cannot start at one
        // instant and leave the rate in force to an id tiebreak.
        await tx
          .select({ id: bedCategories.id })
          .from(bedCategories)
          .where(and(eq(bedCategories.orgId, scope.orgId), eq(bedCategories.id, input.categoryId)))
          .for("update");

        const [sameInstant] = await tx
          .select({ id: bedTariffs.id })
          .from(bedTariffs)
          .where(
            and(
              eq(bedTariffs.orgId, scope.orgId),
              eq(bedTariffs.categoryId, input.categoryId),
              eq(bedTariffs.effectiveFrom, input.effectiveFrom),
            ),
          )
          .limit(1);

        if (sameInstant) {
          throw new ORPCError("CONFLICT", {
            message: "A rate starting at that time already exists.",
          });
        }

        await tx.insert(bedTariffs).values({
          id,
          orgId: scope.orgId,
          categoryId: input.categoryId,
          effectiveFrom: input.effectiveFrom,
          createdBy: scope.userId,
        });

        await tx.insert(bedTariffLines).values(
          input.lines.map((line, position) => ({
            id: Bun.randomUUIDv7(),
            orgId: scope.orgId,
            tariffId: id,
            catalogItemId: line.catalogItemId,
            dailyPrice: line.dailyPrice,
            position,
          })),
        );
        // The unique index backs the check above should the lock ever be bypassed.
      })
      .catch((error: unknown) => nameConflict(error, "A rate starting at that time"));

    const lines = input.lines.map((line) => ({
      catalogItemId: line.catalogItemId,
      dailyPrice: line.dailyPrice,
    }));

    audit({
      action: "ipd.tariff.set",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed_category:${input.categoryId}`,
      meta: {
        tariffId: id,
        effectiveFrom: input.effectiveFrom.toISOString(),
        lines: lines.map((line) => ({
          catalogItemId: line.catalogItemId,
          dailyPrice: line.dailyPrice.toString(),
        })),
      },
    });

    return { id, categoryId: input.categoryId, effectiveFrom: input.effectiveFrom, lines };
  }),

  createBed: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ wardId: z.string(), categoryId: z.string(), label: shortName }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;

    await Promise.all([
      requireInScope(
        db
          .select({ id: wards.id })
          .from(wards)
          .where(and(eq(wards.orgId, orgId), eq(wards.id, input.wardId)))
          .limit(1),
        "That ward no longer exists.",
      ),
      requireInScope(
        db
          .select({ id: bedCategories.id })
          .from(bedCategories)
          .where(and(eq(bedCategories.orgId, orgId), eq(bedCategories.id, input.categoryId)))
          .limit(1),
        "That bed category no longer exists.",
      ),
    ]);

    const bed = await db
      .insert(beds)
      .values({
        id: Bun.randomUUIDv7(),
        orgId,
        wardId: input.wardId,
        categoryId: input.categoryId,
        label: input.label,
      })
      .returning()
      .then(([row]) => row!)
      .catch((error: unknown) => nameConflict(error, "A bed with this label in that ward"));

    audit({
      action: "ipd.bed.create",
      actorId: scope.userId,
      orgId,
      target: `bed:${bed.id}`,
      meta: { label: bed.label, wardId: bed.wardId, categoryId: bed.categoryId },
    });

    return bed;
  }),

  setBedActive: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ bedId: z.string(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const bed = await db.transaction(async (tx) => {
      const locked = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

      if (!locked) {
        throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
      }

      if (!input.active) {
        await assertUnoccupied(tx, scope.orgId, input.bedId);

        // The bed lock already serialises every writer of a hold on it.
        const [held] = await tx
          .select({ id: bedReservations.id })
          .from(bedReservations)
          .where(liveHolds(scope.orgId, input.bedId, new Date()))
          .limit(1);

        if (held) {
          throw new ORPCError("CONFLICT", {
            message: "That bed is held for a planned arrival. Move or cancel the hold first.",
          });
        }
      }

      const [updated] = await tx
        .update(beds)
        .set({ active: input.active, updatedAt: new Date() })
        .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
        .returning();

      return updated!;
    });

    audit({
      action: input.active ? "ipd.bed.activate" : "ipd.bed.deactivate",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed:${input.bedId}`,
    });

    return bed;
  }),

  blockBed: orgProcedure(
    { ipd: ["update"] },
    orgInput.extend({ bedId: z.string(), reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const { bed, disrupted } = await db.transaction(async (tx) => {
      const locked = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

      if (!locked) {
        throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
      }

      await assertUnoccupied(tx, scope.orgId, input.bedId);

      // A safety block is never suppressed. Only owner/admin authority releases the
      // bed's holds; otherwise they stay confirmed and the worklist flags them.
      const disrupted = authorize(scope.roles, { ipd: ["correct"] })
        ? await clearHoldsForOccupancy(
            tx,
            scope.orgId,
            input.bedId,
            { reason: input.reason },
            new Date(),
          )
        : [];

      const [updated] = await tx
        .update(beds)
        .set({ blockedAt: new Date(), blockedReason: input.reason, updatedAt: new Date() })
        .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
        .returning();

      return { bed: updated!, disrupted };
    });

    audit({
      action: "ipd.bed.block",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed:${input.bedId}`,
      meta: { reason: input.reason },
    });
    auditDisruptions(scope, disrupted, {
      reason: input.reason,
      cause: "ipd.blockBed",
      bedId: input.bedId,
    });

    return bed;
  }),

  // Names the block it lifts, so a stale screen cannot clear a newer one.
  releaseBed: orgProcedure(
    { ipd: ["update"] },
    orgInput.extend({ bedId: z.string(), expectedBlockedAt: z.date() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const { bed, released } = await db.transaction(async (tx) => {
      const locked = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

      if (!locked) {
        throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
      }

      await assertUnoccupied(tx, scope.orgId, input.bedId);

      if (locked.blockedAt?.getTime() !== input.expectedBlockedAt.getTime()) {
        throw new ORPCError("CONFLICT", {
          message: "This bed changed on another screen. Refresh and try again.",
        });
      }

      const [updated] = await tx
        .update(beds)
        .set({ blockedAt: null, blockedReason: null, updatedAt: new Date() })
        .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
        .returning();

      return { bed: updated!, released: locked };
    });

    audit({
      action: "ipd.bed.release",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed:${input.bedId}`,
      meta: { blockedAt: released.blockedAt!.toISOString(), blockedReason: released.blockedReason },
    });

    return bed;
  }),

  bedBoard: orgProcedure({ ipd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const boardRows = db
      .select({
        id: beds.id,
        label: beds.label,
        wardId: wards.id,
        wardName: wards.name,
        categoryId: beds.categoryId,
        categoryName: bedCategories.name,
        blockedAt: beds.blockedAt,
        blockedReason: beds.blockedReason,
        admissionId: admissions.id,
        admissionStatus: admissions.status,
        admittedAt: admissions.admittedAt,
        patientId: patients.id,
        patientName: patients.name,
        mrn: patients.mrn,
        practitionerName: practitioners.name,
      })
      .from(beds)
      .innerJoin(wards, and(eq(wards.orgId, beds.orgId), eq(wards.id, beds.wardId)))
      .innerJoin(
        bedCategories,
        and(eq(bedCategories.orgId, beds.orgId), eq(bedCategories.id, beds.categoryId)),
      )
      .leftJoin(
        admissionBedStays,
        and(
          eq(admissionBedStays.orgId, beds.orgId),
          eq(admissionBedStays.bedId, beds.id),
          isNull(admissionBedStays.endedAt),
        ),
      )
      .leftJoin(
        admissions,
        and(
          eq(admissions.orgId, admissionBedStays.orgId),
          eq(admissions.id, admissionBedStays.admissionId),
        ),
      )
      .leftJoin(
        patients,
        and(eq(patients.orgId, admissions.orgId), eq(patients.id, admissions.patientId)),
      )
      .leftJoin(
        practitioners,
        and(
          eq(practitioners.orgId, admissions.orgId),
          eq(practitioners.id, admissions.practitionerId),
        ),
      )
      .where(and(eq(beds.orgId, orgId), eq(beds.active, true)))
      .orderBy(asc(wards.name), asc(beds.label));

    const now = new Date();

    const [rows, tariffRows, holds] = await Promise.all([
      boardRows,
      currentTariffs(orgId),
      boardHolds(orgId, now),
    ]);

    const priced = new Set(tariffRows.map((tariff) => tariff.categoryId));

    const occupied = rows.flatMap((row) => (row.admissionId ? [row.admissionId] : []));

    const [runningBills, depositsHeld] = await Promise.all([
      readRunningBills(db, orgId, occupied, now),
      readDepositsHeld(db, orgId, occupied),
    ]);

    return {
      beds: rows.map((row) => {
        // Foreign keys guarantee the rest of the chain once a stay is open.
        const admission = row.admissionId
          ? {
              id: row.admissionId,
              status: row.admissionStatus!,
              admittedAt: row.admittedAt!,
              patientId: row.patientId!,
              patientName: row.patientName!,
              mrn: row.mrn!,
              practitionerName: row.practitionerName!,
              runningBill: runningBills.get(row.admissionId)!.amount,
              depositHeld: depositsHeld.get(row.admissionId)!,
            }
          : null;

        return {
          id: row.id,
          label: row.label,
          wardId: row.wardId,
          wardName: row.wardName,
          categoryName: row.categoryName,
          // Admission refuses a bed whose category has no rate in force.
          rateSet: priced.has(row.categoryId),
          status: admission
            ? ("occupied" as const)
            : row.blockedAt
              ? ("blocked" as const)
              : ("available" as const),
          blockedAt: row.blockedAt,
          blockedReason: row.blockedReason,
          admission,
          holds: holds.get(row.id) ?? [],
        };
      }),
    };
  }),

  list: orgProcedure(
    { ipd: ["read"] },
    orgInput.extend({
      state: z.enum(["current", "past", "all"]).default("current"),
      // One Patient's stays, for a picker that links one of them.
      patientId: z.string().optional(),
      // Newest admission time first; backdated entries sort by when care began.
      cursor: z.object({ admittedAt: z.date(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const items = await db
      .select({
        id: admissions.id,
        admissionNumber: admissions.admissionNumber,
        status: admissions.status,
        admittedAt: admissions.admittedAt,
        readyAt: admissions.readyAt,
        dischargedAt: admissions.dischargedAt,
        patientId: patients.id,
        patientName: patients.name,
        mrn: patients.mrn,
        practitionerName: practitioners.name,
        bedLabel: beds.label,
        wardName: wards.name,
      })
      .from(admissions)
      .innerJoin(
        patients,
        and(eq(patients.orgId, admissions.orgId), eq(patients.id, admissions.patientId)),
      )
      .innerJoin(
        practitioners,
        and(
          eq(practitioners.orgId, admissions.orgId),
          eq(practitioners.id, admissions.practitionerId),
        ),
      )
      .leftJoin(
        admissionBedStays,
        and(
          eq(admissionBedStays.orgId, admissions.orgId),
          eq(admissionBedStays.admissionId, admissions.id),
          isNull(admissionBedStays.endedAt),
        ),
      )
      .leftJoin(
        beds,
        and(eq(beds.orgId, admissionBedStays.orgId), eq(beds.id, admissionBedStays.bedId)),
      )
      .leftJoin(wards, and(eq(wards.orgId, beds.orgId), eq(wards.id, beds.wardId)))
      .where(
        and(
          eq(admissions.orgId, orgId),
          input.patientId ? eq(admissions.patientId, input.patientId) : undefined,
          input.state === "all"
            ? undefined
            : inArray(admissions.status, ADMISSION_STATES[input.state]),
          input.cursor
            ? sql`(${admissions.admittedAt}, ${admissions.id}) < (${input.cursor.admittedAt}, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(admissions.admittedAt), desc(admissions.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;

    if (hasNextPage) {
      items.pop();
    }

    const last = items.at(-1);

    const ids = items.map((item) => item.id);

    const [runningBills, depositsHeld] = await Promise.all([
      readRunningBills(db, orgId, ids, new Date()),
      readDepositsHeld(db, orgId, ids),
    ]);

    return {
      // SAFETY: one running bill and one deposit per Admission listed.
      items: items.map((item) => ({
        ...item,
        runningBill: runningBills.get(item.id)!.amount,
        depositHeld: depositsHeld.get(item.id)!,
      })),
      nextCursor: hasNextPage && last ? { admittedAt: last.admittedAt, id: last.id } : null,
    };
  }),

  get: orgProcedure({ ipd: ["read"] }, orgInput.extend({ admissionId: z.string() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      // One snapshot, so a concurrent move or departure cannot split admission and beds.
      return db.transaction(
        async (tx) => {
          const [row] = await tx
            .select({
              ...admissionSelection,
              patientName: patients.name,
              mrn: patients.mrn,
              practitionerName: practitioners.name,
            })
            .from(admissions)
            .innerJoin(
              patients,
              and(eq(patients.orgId, admissions.orgId), eq(patients.id, admissions.patientId)),
            )
            .innerJoin(
              practitioners,
              and(
                eq(practitioners.orgId, admissions.orgId),
                eq(practitioners.id, admissions.practitionerId),
              ),
            )
            .where(and(eq(admissions.orgId, orgId), eq(admissions.id, input.admissionId)))
            .limit(1);

          if (!row) {
            throw new ORPCError("NOT_FOUND", { message: "That admission does not exist." });
          }

          const [stays, runningBills, depositsHeld] = await Promise.all([
            tx
              .select({
                id: admissionBedStays.id,
                bedId: admissionBedStays.bedId,
                bedLabel: beds.label,
                wardName: wards.name,
                // The tariff a segment started under is its price and its bed type.
                tariffId: admissionBedStays.tariffId,
                categoryId: bedTariffs.categoryId,
                categoryName: bedCategories.name,
                startedAt: admissionBedStays.startedAt,
                endedAt: admissionBedStays.endedAt,
              })
              .from(admissionBedStays)
              .innerJoin(
                beds,
                and(eq(beds.orgId, admissionBedStays.orgId), eq(beds.id, admissionBedStays.bedId)),
              )
              .innerJoin(wards, and(eq(wards.orgId, beds.orgId), eq(wards.id, beds.wardId)))
              .innerJoin(
                bedTariffs,
                and(
                  eq(bedTariffs.orgId, admissionBedStays.orgId),
                  eq(bedTariffs.id, admissionBedStays.tariffId),
                ),
              )
              .innerJoin(
                bedCategories,
                and(
                  eq(bedCategories.orgId, bedTariffs.orgId),
                  eq(bedCategories.id, bedTariffs.categoryId),
                ),
              )
              .where(
                and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, row.id)),
              )
              .orderBy(asc(admissionBedStays.startedAt), asc(admissionBedStays.id)),
            readRunningBills(tx, orgId, [row.id], new Date()),
            readDepositsHeld(tx, orgId, [row.id]),
          ]);

          const { patientName, mrn, practitionerName, ...admission } = row;
          const current = stays.find((stay) => stay.endedAt === null);

          return {
            admission: admissionView(admission, current?.bedId ?? null),
            patient: { id: admission.patientId, name: patientName, mrn },
            practitionerName,
            stays,
            // SAFETY: one running bill and one deposit per Admission read.
            runningBill: runningBills.get(row.id)!.amount,
            depositHeld: depositsHeld.get(row.id)!,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  ),

  admit: orgProcedure(
    { ipd: ["create"] },
    orgInput
      .extend({
        patientId: z.string(),
        practitionerId: z.string(),
        bedId: z.string(),
        admittedAt: z.date().optional(),
        reason: reason.optional(),
        // Arrival against a confirmed hold converts it in the same transaction.
        reservationId: z.string().optional(),
        expectedReservationRevision: z.number().int().nonnegative().optional(),
        attendantName: stayFacts.attendantName.optional(),
        attendantPhone: stayFacts.attendantPhone.optional(),
        medicoLegal: z.boolean().default(false),
        medicoLegalRef: stayFacts.medicoLegalRef.optional(),
        diagnosis: stayFacts.diagnosis.optional(),
        ...displaceInput,
      })
      .refine(
        (value) =>
          (value.reservationId === undefined) === (value.expectedReservationRevision === undefined),
        { message: "A reservation needs its expected revision.", path: ["reservationId"] },
      )
      .refine((value) => value.medicoLegal || !value.medicoLegalRef, {
        message: MEDICO_LEGAL_REF_NEEDS_FLAG,
        path: ["medicoLegalRef"],
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.admittedAt, input.reason);
    requireDisplaceGrant(scope, input.displace);
    const { settings, fiscalYear } = await billingDocumentContext(scope.orgId);

    await requireInScope(
      db
        .select({ id: practitioners.id })
        .from(practitioners)
        .where(
          and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, input.practitionerId)),
        )
        .limit(1),
      "That practitioner no longer exists.",
    );

    const { admission, disrupted } = await db
      .transaction(async (tx) => {
        // Lock order (D040): Patient, then Admission, then beds by id.
        await requireInScope(
          tx
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
            .limit(1)
            .for("update"),
          "That Patient no longer exists.",
        );

        // One stay per Patient at a time, including a backdated one against a past stay.
        const [overlap] = await tx
          .select({ status: admissions.status })
          .from(admissions)
          .where(
            and(
              eq(admissions.orgId, scope.orgId),
              eq(admissions.patientId, input.patientId),
              or(
                inArray(admissions.status, ACTIVE_ADMISSION_STATUSES),
                gt(admissions.dischargedAt, effective.at),
              ),
            ),
          )
          .limit(1);

        if (overlap?.status === "discharged") {
          throw new ORPCError("BAD_REQUEST", {
            message: "This Patient was still in hospital at that time.",
          });
        }

        if (overlap) {
          throw new ORPCError("CONFLICT", { message: "This Patient is already admitted." });
        }

        // A walk-in would leave the Patient's reservation live, and its bed held for nobody.
        if (input.reservationId === undefined) {
          const [reserved] = await tx
            .select({ id: bedReservations.id })
            .from(bedReservations)
            .where(
              and(
                eq(bedReservations.orgId, scope.orgId),
                eq(bedReservations.patientId, input.patientId),
                inArray(bedReservations.status, ["requested", "confirmed"]),
                or(isNull(bedReservations.holdUntil), gt(bedReservations.holdUntil, new Date())),
              ),
            )
            .limit(1);

          if (reserved) {
            throw new ORPCError("CONFLICT", {
              message: "This Patient has a reservation. Admit them from it, or cancel it first.",
            });
          }
        }

        const bed = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

        if (!bed) {
          throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
        }

        const { reservationId, expectedReservationRevision } = input;

        if (reservationId !== undefined && expectedReservationRevision !== undefined) {
          await lockHoldForArrival(
            tx,
            scope.orgId,
            {
              reservationId,
              expectedRevision: expectedReservationRevision,
              patientId: input.patientId,
              bedId: bed.id,
            },
            effective.at,
          );
        }

        await assertBedFree(tx, scope.orgId, bed, effective.at);

        // Every other live hold on the bed stands in the way, for a conversion too; the
        // clock is read after the locks, so a hold that lapsed meanwhile no longer counts.
        const disrupted = await clearHoldsForOccupancy(
          tx,
          scope.orgId,
          bed.id,
          input.displace,
          new Date(),
          reservationId,
        );

        const tariff = await tariffAt(tx, scope.orgId, bed.categoryId, effective.at);

        // After the domain locks, so a refused admit takes no number.
        const sequence = await nextCounter(tx, scope.orgId, `admission:${fiscalYear}`);
        const id = Bun.randomUUIDv7();

        const [created] = await tx
          .insert(admissions)
          .values({
            id,
            orgId: scope.orgId,
            admissionNumber: `${fiscalYear}/${sequence}`,
            patientId: input.patientId,
            practitionerId: input.practitionerId,
            status: "admitted",
            admittedAt: effective.at,
            attendantName: input.attendantName ?? null,
            attendantPhone: input.attendantPhone ?? null,
            medicoLegal: input.medicoLegal,
            medicoLegalRef: input.medicoLegalRef ?? null,
            diagnosis: input.diagnosis ?? null,
            timeZone: settings.timeZone,
            checkoutMinutes: settings.ipdCheckoutMinutes,
            createdBy: scope.userId,
          })
          .returning(admissionSelection);

        await tx.insert(admissionBedStays).values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          admissionId: id,
          bedId: bed.id,
          tariffId: tariff.id,
          startedAt: effective.at,
          createdBy: scope.userId,
        });

        if (reservationId !== undefined) {
          await markConverted(tx, scope.orgId, reservationId, id);
        }

        return { admission: admissionView(created!, bed.id), disrupted };
      })
      .catch(occupancyConflict);

    auditBackdate(
      scope,
      "ipd.admit.backdate",
      admission.id,
      effective,
      input.reason,
      input.reservationId,
    );

    if (input.reservationId !== undefined) {
      auditReservation(scope, "ipd.reservation.convert", input.reservationId, {
        admissionId: admission.id,
        bedId: input.bedId,
      });
    }

    if (input.displace) {
      auditDisruptions(scope, disrupted, {
        reason: input.displace.reason,
        cause: "ipd.admit",
        bedId: input.bedId,
        admissionId: admission.id,
      });
    }

    return admission;
  }),

  transferBed: orgProcedure(
    { ipd: ["update"] },
    transitionInput.extend({ bedId: z.string(), ...effectiveInput, ...displaceInput }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.effectiveAt, input.reason);
    requireDisplaceGrant(scope, input.displace);

    const { admission, disrupted } = await db
      .transaction(async (tx) => {
        const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
        requireStatus(row, ACTIVE_ADMISSION_STATUSES, "This admission has ended.");

        const stay = await openStay(tx, scope.orgId, row.id);

        if (stay.bedId === input.bedId) {
          throw new ORPCError("CONFLICT", { message: "The Patient is already in that bed." });
        }

        requireNotBeforeStay(effective.at, stay);

        const locked = await lockBeds(tx, scope.orgId, [stay.bedId, input.bedId]);
        const destination = locked.get(input.bedId);

        if (!destination) {
          throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
        }

        await assertBedFree(tx, scope.orgId, destination, effective.at);

        const disrupted = await clearHoldsForOccupancy(
          tx,
          scope.orgId,
          destination.id,
          input.displace,
          new Date(),
        );

        const tariff = await tariffAt(tx, scope.orgId, destination.categoryId, effective.at);
        const now = new Date();

        await requireBilledDaysKept(tx, scope.orgId, row, {
          before: now,
          after: now,
          rewrite: (stays) => [
            ...stays.map((segment) =>
              segment.endedAt === null ? { ...segment, endedAt: effective.at } : segment,
            ),
            {
              startedAt: effective.at,
              endedAt: null,
              categoryId: destination.categoryId,
              tariffId: tariff.id,
            },
          ],
        });

        await tx
          .update(admissionBedStays)
          .set({ endedAt: effective.at })
          .where(and(eq(admissionBedStays.orgId, scope.orgId), eq(admissionBedStays.id, stay.id)));

        await tx.insert(admissionBedStays).values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          admissionId: row.id,
          bedId: destination.id,
          tariffId: tariff.id,
          startedAt: effective.at,
          createdBy: scope.userId,
        });

        const [updated] = await tx
          .update(admissions)
          .set({ revision: sql`${admissions.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
          .returning(admissionSelection);

        return { admission: admissionView(updated!, destination.id), disrupted };
      })
      .catch(occupancyConflict);

    auditBackdate(scope, "ipd.transfer.backdate", admission.id, effective, input.reason);

    if (input.displace) {
      auditDisruptions(scope, disrupted, {
        reason: input.displace.reason,
        cause: "ipd.transferBed",
        bedId: input.bedId,
        admissionId: admission.id,
      });
    }

    return admission;
  }),

  markDischargeReady: orgProcedure(
    { ipd: ["update"] },
    transitionInput.extend(effectiveInput),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.effectiveAt, input.reason);

    const admission = await db.transaction(async (tx) => {
      const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
      requireStatus(row, ["admitted"], "Only an admitted Patient can be made ready for discharge.");

      const stay = await openStay(tx, scope.orgId, row.id);
      requireNotBeforeStay(effective.at, stay);

      const [updated] = await tx
        .update(admissions)
        .set({
          status: "discharge_ready",
          readyAt: effective.at,
          revision: sql`${admissions.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
        .returning(admissionSelection);

      return admissionView(updated!, stay.bedId);
    });

    auditBackdate(scope, "ipd.discharge_ready.backdate", admission.id, effective, input.reason);

    return admission;
  }),

  undoDischargeReady: orgProcedure({ ipd: ["update"] }, transitionInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;

      const admission = await db.transaction(async (tx) => {
        const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
        requireStatus(row, ["discharge_ready"], "This admission is not waiting for discharge.");

        const stay = await openStay(tx, scope.orgId, row.id);

        const [updated] = await tx
          .update(admissions)
          .set({
            status: "admitted",
            readyAt: null,
            revision: sql`${admissions.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
          .returning(admissionSelection);

        return admissionView(updated!, stay.bedId);
      });

      audit({
        action: "ipd.discharge_ready.undo",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `admission:${admission.id}`,
        meta: { reason: input.reason },
      });

      return admission;
    },
  ),

  // Departure never waits for billing or payment; the bed is blocked until cleaned.
  discharge: orgProcedure(
    { ipd: ["update"] },
    transitionInput.extend({ ...effectiveInput, dischargeType: z.enum(DISCHARGE_TYPES) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.effectiveAt, input.reason);

    const admission = await db.transaction(async (tx) => {
      const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
      requireStatus(row, ["discharge_ready"], "Mark the Patient ready for discharge first.");

      const stay = await openStay(tx, scope.orgId, row.id);
      requireNotBeforeStay(effective.at, stay);

      if (row.readyAt && effective.at.getTime() < row.readyAt.getTime()) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That time is before the Patient was ready to leave.",
        });
      }

      await requireBilledDaysKept(tx, scope.orgId, row, {
        before: new Date(),
        after: effective.at,
        rewrite: (stays) =>
          stays.map((segment) =>
            segment.endedAt === null ? { ...segment, endedAt: effective.at } : segment,
          ),
      });

      await lockBeds(tx, scope.orgId, [stay.bedId]);

      await tx
        .update(admissionBedStays)
        .set({ endedAt: effective.at })
        .where(and(eq(admissionBedStays.orgId, scope.orgId), eq(admissionBedStays.id, stay.id)));

      await tx
        .update(beds)
        .set({ blockedAt: new Date(), blockedReason: AWAITING_CLEANING, updatedAt: new Date() })
        .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, stay.bedId)));

      const [updated] = await tx
        .update(admissions)
        .set({
          status: "discharged",
          dischargedAt: effective.at,
          dischargeType: input.dischargeType,
          revision: sql`${admissions.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
        .returning(admissionSelection);

      return admissionView(updated!, null);
    });

    auditBackdate(scope, "ipd.discharge.backdate", admission.id, effective, input.reason);

    return admission;
  }),

  // The stay's own facts and its consultant, while the Patient is in the ward.
  updateDetails: orgProcedure(
    { ipd: ["update"] },
    transitionInput.extend({
      attendantName: stayFacts.attendantName.nullable().optional(),
      attendantPhone: stayFacts.attendantPhone.nullable().optional(),
      medicoLegal: z.boolean().optional(),
      medicoLegalRef: stayFacts.medicoLegalRef.nullable().optional(),
      diagnosis: stayFacts.diagnosis.nullable().optional(),
      practitionerId: z.string().optional(),
      reason: reason.optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    if (input.practitionerId !== undefined) {
      await requireInScope(
        db
          .select({ id: practitioners.id })
          .from(practitioners)
          .where(
            and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, input.practitionerId)),
          )
          .limit(1),
        "That practitioner no longer exists.",
      );
    }

    const { admission, previousPractitionerId } = await db.transaction(async (tx) => {
      const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
      requireStatus(row, ACTIVE_ADMISSION_STATUSES, "This admission has ended.");

      const consultantChanged =
        input.practitionerId !== undefined && input.practitionerId !== row.practitionerId;

      if (consultantChanged && !input.reason) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Give a reason for changing the consultant.",
        });
      }

      // Turning the flag off clears its reference.
      const medicoLegal = input.medicoLegal ?? row.medicoLegal;

      const medicoLegalRef =
        input.medicoLegalRef !== undefined
          ? input.medicoLegalRef
          : medicoLegal
            ? row.medicoLegalRef
            : null;

      if (medicoLegalRef !== null && !medicoLegal) {
        throw new ORPCError("BAD_REQUEST", { message: MEDICO_LEGAL_REF_NEEDS_FLAG });
      }

      const stay = await openStay(tx, scope.orgId, row.id);

      const [updated] = await tx
        .update(admissions)
        .set({
          attendantName: input.attendantName,
          attendantPhone: input.attendantPhone,
          diagnosis: input.diagnosis,
          practitionerId: input.practitionerId,
          medicoLegal,
          medicoLegalRef,
          revision: sql`${admissions.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
        .returning(admissionSelection);

      return {
        admission: admissionView(updated!, stay.bedId),
        previousPractitionerId: consultantChanged ? row.practitionerId : null,
      };
    });

    if (previousPractitionerId !== null) {
      audit({
        action: "ipd.consultant.change",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `admission:${admission.id}`,
        meta: { from: previousPractitionerId, to: admission.practitionerId, reason: input.reason },
      });
    }

    return admission;
  }),

  // Reverses a discharge recorded in error, while nothing has happened to the bed since.
  // Outside these conditions the answer is a new Admission.
  reopen: orgProcedure({ ipd: ["correct"] }, transitionInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const refused = (message: string) => new ORPCError("CONFLICT", { message });

      const admission = await db
        .transaction(async (tx) => {
          const row = await lockAdmission(
            tx,
            scope.orgId,
            input.admissionId,
            input.expectedRevision,
          );

          requireStatus(row, ["discharged"], "Only a discharged admission can be reopened.");

          const now = new Date();

          if (now.getTime() - row.dischargedAt!.getTime() > REOPEN_WINDOW_MS) {
            throw refused(
              "A discharge can be undone only within 24 hours. Admit the Patient again.",
            );
          }

          const [stay] = await tx
            .select({
              id: admissionBedStays.id,
              bedId: admissionBedStays.bedId,
              startedAt: admissionBedStays.startedAt,
            })
            .from(admissionBedStays)
            .where(
              and(
                eq(admissionBedStays.orgId, scope.orgId),
                eq(admissionBedStays.admissionId, row.id),
              ),
            )
            .orderBy(desc(admissionBedStays.startedAt), desc(admissionBedStays.id))
            .limit(1);

          if (!stay) throw impossible(`discharged admission ${row.id} has no stay`);

          const bed = (await lockBeds(tx, scope.orgId, [stay.bedId])).get(stay.bedId);

          if (!bed) throw impossible(`stay ${stay.id} lost its bed`);

          if (!bed.active || (bed.blockedAt && bed.blockedReason !== AWAITING_CLEANING)) {
            throw refused("That bed is no longer available. Admit the Patient again.");
          }

          // Another Patient's stay in the bed since, or this Patient's own later stay.
          const [since] = await tx
            .select({ id: admissionBedStays.id })
            .from(admissionBedStays)
            .innerJoin(
              admissions,
              and(
                eq(admissions.orgId, admissionBedStays.orgId),
                eq(admissions.id, admissionBedStays.admissionId),
              ),
            )
            .where(
              and(
                eq(admissionBedStays.orgId, scope.orgId),
                ne(admissions.id, row.id),
                ne(admissions.status, "cancelled"),
                or(
                  and(
                    eq(admissionBedStays.bedId, stay.bedId),
                    or(
                      isNull(admissionBedStays.endedAt),
                      gte(admissionBedStays.startedAt, stay.startedAt),
                    ),
                  ),
                  and(
                    eq(admissions.patientId, row.patientId),
                    gte(admissions.admittedAt, row.admittedAt),
                  ),
                ),
              ),
            )
            .limit(1);

          if (since) {
            throw refused("The bed or the Patient has moved on since. Admit the Patient again.");
          }

          const [held] = await tx
            .select({ id: bedReservations.id })
            .from(bedReservations)
            .where(
              and(
                liveHolds(scope.orgId, stay.bedId, now),
                ne(bedReservations.patientId, row.patientId),
              ),
            )
            .limit(1);

          if (held) {
            throw refused("That bed is held for another Patient. Admit the Patient again.");
          }

          await requireBilledDaysKept(tx, scope.orgId, row, {
            before: row.dischargedAt!,
            after: now,
            // The last segment, which this reopens, is the latest to start.
            rewrite: (stays) =>
              stays.map((segment, index) =>
                index === stays.length - 1 ? { ...segment, endedAt: null } : segment,
              ),
          });

          await tx
            .update(admissionBedStays)
            .set({ endedAt: null })
            .where(
              and(eq(admissionBedStays.orgId, scope.orgId), eq(admissionBedStays.id, stay.id)),
            );

          if (bed.blockedAt) {
            await tx
              .update(beds)
              .set({ blockedAt: null, blockedReason: null, updatedAt: now })
              .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, bed.id)));
          }

          const [updated] = await tx
            .update(admissions)
            .set({
              status: "admitted",
              readyAt: null,
              dischargedAt: null,
              dischargeType: null,
              revision: sql`${admissions.revision} + 1`,
              updatedAt: now,
            })
            .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
            .returning(admissionSelection);

          return admissionView(updated!, stay.bedId);
        })
        .catch(occupancyConflict);

      audit({
        action: "ipd.reopen",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `admission:${admission.id}`,
        meta: { reason: input.reason },
      });

      return admission;
    },
  ),

  postServices: orgProcedure(
    { ipd: ["read"], billing: ["write"] },
    orgInput.extend({
      admissionId: z.string(),
      expectedChargeRevision,
      lines: z
        .array(z.object({ catalogItemId: z.string(), qty: z.number().int().positive() }))
        .min(1),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();

    // Read unlocked, as OPD does: the Charge snapshots price and tax at posting.
    const items = await db
      .select({
        id: catalogItems.id,
        name: catalogItems.name,
        category: catalogItems.category,
        unitPrice: catalogItems.unitPrice,
        taxRatePercent: catalogItems.taxRatePercent,
        taxCode: catalogItems.taxCode,
      })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.orgId, scope.orgId),
          eq(catalogItems.active, true),
          inArray(
            catalogItems.id,
            input.lines.map((line) => line.catalogItemId),
          ),
        ),
      );

    const itemById = new Map(items.map((item) => [item.id, item]));

    const rows = input.lines.map((line) => {
      const item = itemById.get(line.catalogItemId);

      if (!item) {
        throw new ORPCError("NOT_FOUND", { message: "That service is no longer available." });
      }

      return {
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        admissionId: input.admissionId,
        admissionKind: "service" as const,
        catalogItemId: item.id,
        description: item.name,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
        revenueCategory: item.category,
        qty: line.qty,
        sourceType: "admission" as const,
        sourceId: input.admissionId,
        status: "pending" as const,
        createdBy: scope.userId,
        createdAt: now,
        updatedAt: now,
      };
    });

    // No GSTIN, no GST (D063): refuse here rather than at the Invoice. Issuance still
    // checks, since a GSTIN can be cleared after posting.
    if (
      rows.some((row) => Number(row.taxRatePercent) > 0) &&
      !(await readOrgSettings(scope.orgId)).gstin
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This hospital has no GSTIN, so a service that charges GST cannot go on an inpatient bill. Set the service to 0% GST first.",
      });
    }

    return db.transaction(async (tx) => {
      const admission = await lockAdmissionCharges(tx, scope.orgId, input.admissionId);

      requireChargeable(admission, {
        allowed: ["admitted", "discharge_ready", "discharged"],
        message: "Services cannot be posted to a cancelled admission.",
        expectedChargeRevision: input.expectedChargeRevision,
      });

      await tx.insert(charges).values(rows);

      return { chargeRevision: await bumpChargeRevision(tx, scope.orgId, admission.id) };
    });
  }),

  // The stay's bill: the pending Charges and unbilled bed days through `through`, and the
  // bills already issued (D066). An issued Invoice's lines are read through the Invoice
  // procedures. Bed days are derived here and written as Charges only by the bill.
  previewInvoice: orgProcedure(
    { ipd: ["read"], billing: ["read"] },
    orgInput.extend({
      admissionId: z.string(),
      lastDay: z.enum(LAST_DAY_CHOICES).default("full"),
      discountAmount: money.default(0n),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const settings = await readOrgSettings(orgId);
    const now = new Date();

    return db.transaction(
      async (tx) => {
        const [admission] = await tx
          .select({
            ...billAdmissionSelection,
            chargeRevision: admissions.chargeRevision,
            patientId: admissions.patientId,
          })
          .from(admissions)
          .where(and(eq(admissions.orgId, orgId), eq(admissions.id, input.admissionId)))
          .limit(1);

        if (!admission) {
          throw new ORPCError("NOT_FOUND", { message: "That admission does not exist." });
        }

        const remaining = advanceRemaining(orgId);
        const ofThisStay = eq(advanceReceipts.admissionId, admission.id);

        const [bill, issued, [credit]] = await Promise.all([
          readPendingBill(tx, orgId, admission, input.lastDay, input.discountAmount, now),
          tx
            .select({
              invoiceId: invoices.id,
              invoiceNumber: invoices.invoiceNumber,
              issuedAt: invoices.createdAt,
              grandTotal: invoices.grandTotal,
            })
            .from(invoices)
            .where(and(eq(invoices.orgId, orgId), eq(invoices.admissionId, input.admissionId)))
            .orderBy(asc(invoices.createdAt), asc(invoices.id)),
          // What the bill may draw on: this stay's deposit, then credit tagged to nothing.
          tx
            .select({
              deposit:
                sql<bigint>`coalesce(sum(${remaining}) filter (where ${ofThisStay}), 0)::bigint`.mapWith(
                  BigInt,
                ),
              other:
                sql<bigint>`coalesce(sum(${remaining}) filter (where ${advanceReceipts.admissionId} is null), 0)::bigint`.mapWith(
                  BigInt,
                ),
            })
            .from(advanceReceipts)
            .where(
              and(
                eq(advanceReceipts.orgId, orgId),
                eq(advanceReceipts.patientId, admission.patientId),
                or(
                  ofThisStay,
                  and(isNull(advanceReceipts.admissionId), isNull(advanceReceipts.treatmentPlanId)),
                ),
              ),
            ),
        ]);

        return {
          chargeRevision: admission.chargeRevision,
          // Whether a pending line's words may claim GST (D052): today's GSTIN.
          registered: Boolean(settings.gstin),
          ...bill,
          issued,
          // SAFETY: an aggregate without GROUP BY returns exactly one row.
          credit: credit!,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }),

  issueInvoice: orgProcedure(
    { ipd: ["read"], billing: ["write"] },
    orgInput
      .extend({
        admissionId: z.string(),
        expectedChargeRevision,
        expectedGrandTotal: money,
        // The cashier's call on the last unbilled day; anything but full needs a reason.
        lastDay: z.enum(LAST_DAY_CHOICES).default("full"),
        lastDayReason: reason.optional(),
        discountAmount: money.default(0n),
        discountReason: reason.optional(),
        // Drawn from this stay's deposit first, then the Patient's untagged credit.
        applyCredit: money.default(0n),
        payments: z.array(paymentLine).max(4).default([]),
        outstandingReason: reason.optional(),
      })
      .refine((value) => value.lastDay === "full" || value.lastDayReason !== undefined, {
        message: "Give a reason for the last day.",
        path: ["lastDayReason"],
      })
      .refine((value) => value.discountAmount === 0n || value.discountReason !== undefined, {
        message: "Add a reason for the discount",
        path: ["discountReason"],
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const invoiceId = Bun.randomUUIDv7();

    const result = await db.transaction(async (tx) => {
      const admission = await lockAdmissionCharges(tx, scope.orgId, input.admissionId);

      requireChargeable(admission, {
        allowed: ["discharge_ready", "discharged"],
        message: "Mark the Patient ready for discharge before issuing the bill.",
        expectedChargeRevision: input.expectedChargeRevision,
      });

      await requireUnderCashLimit(tx, scope.orgId, admission.id, input.payments);

      const bedDay = await readBedDayBill(tx, scope.orgId, admission, input.lastDay, now);

      // Bed-day Charges exist only once billed: written here, invoiced below in the same
      // transaction. Created after every pending Charge, in bill order, so the Invoice
      // lists them as the preview does.
      if (bedDay.lines.length > 0) {
        const createdAt = new Date();
        const ids = bedDay.lines.map(() => Bun.randomUUIDv7()).toSorted();

        await tx.insert(charges).values(
          bedDay.lines.map((line, index) => ({
            ...line,
            id: ids[index]!,
            orgId: scope.orgId,
            admissionId: admission.id,
            admissionKind: "bed_day" as const,
            sourceType: "admission" as const,
            sourceId: admission.id,
            status: "pending" as const,
            createdBy: scope.userId,
            createdAt,
            updatedAt: createdAt,
          })),
        );
      }

      const billed = async () => {
        const [row] = await tx
          .update(admissions)
          .set({
            bedDaysBilled: Math.max(admission.bedDaysBilled, bedDay.days),
            chargeRevision: sql`${admissions.chargeRevision} + 1`,
          })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, admission.id)))
          .returning({ chargeRevision: admissions.chargeRevision });

        if (!row) throw impossible("locked admission vanished before billing");

        return row.chargeRevision;
      };

      // Days to deal with but nothing to charge, such as one uncharged last day: no
      // Invoice, only the billed days advance.
      if (
        bedDay.lines.length === 0 &&
        bedDay.unbilled.length > 0 &&
        !(await hasPendingCharges(tx, scope.orgId, admission.id))
      ) {
        if (input.payments.length > 0 || input.applyCredit > 0n || input.discountAmount > 0n) {
          throw new ORPCError("BAD_REQUEST", { message: "There is nothing to collect." });
        }

        if (input.expectedGrandTotal !== 0n) {
          throw new ORPCError("CONFLICT", {
            message: "The charges changed. Review the bill and try again",
          });
        }

        return { invoice: null, payments: [], chargeRevision: await billed(), bedDay };
      }

      const guardian = guardianLabel(admission.patient);

      const issued = await issueInvoiceTx(tx, {
        scope,
        parent: {
          stream: "ipd",
          admissionId: admission.id,
          patient: {
            id: admission.patient.id,
            name: admission.patient.name,
            mrn: admission.patient.mrn,
            phone: admission.patient.phone,
            address: admission.patient.address,
            guardian: guardian ? `${guardian.relation} ${guardian.name}` : null,
          },
        },
        discountAmount: input.discountAmount,
        // The Invoice keeps both reasons, once when the desk gave one for both; each was
        // required above or by the settlement.
        note:
          [...new Set([input.discountReason, input.outstandingReason])]
            .filter(Boolean)
            .join(" · ") || undefined,
        settings,
        now,
        fiscalYear,
        invoiceId,
      });

      const payments = await settleIssuedInvoiceTx(tx, {
        scope,
        invoice: issued.invoice,
        expectedGrandTotal: input.expectedGrandTotal,
        payments: input.payments,
        applyCredit: input.applyCredit,
        outstandingReason: input.outstandingReason,
        settings,
        now,
        fiscalYear,
      });

      return { invoice: issued.invoice, payments, chargeRevision: await billed(), bedDay };
    });

    const { adjusted } = result.bedDay;

    if (adjusted) {
      audit({
        action: "ipd.lastDay.adjust",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `admission:${input.admissionId}`,
        meta: {
          lastDay: input.lastDay,
          reason: input.lastDayReason,
          day: adjusted.day,
          date: adjusted.date,
        },
      });
    }

    if (result.invoice) {
      audit({
        action: "ipd.issueInvoice",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `invoice:${invoiceId}`,
        meta: {
          admissionId: input.admissionId,
          invoiceNumber: result.invoice.invoiceNumber,
          grandTotal: formatDecimal(result.invoice.grandTotal),
        },
      });
    }

    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: formatDecimal(payment.amount) },
      });
    }

    return {
      invoiceId: result.invoice ? invoiceId : null,
      receiptIds: result.payments.map((payment) => payment.id),
      chargeRevision: result.chargeRevision,
    };
  }),

  // Reverses an erroneous Admission. Once care was delivered, discharge instead.
  cancel: orgProcedure({ ipd: ["correct"] }, transitionInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();

      const admission = await db.transaction(async (tx) => {
        const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
        requireStatus(row, ACTIVE_ADMISSION_STATUSES, "This admission has already ended.");
        await requireNoCare(tx, scope.orgId, row.id);

        const stay = await openStay(tx, scope.orgId, row.id);
        await lockBeds(tx, scope.orgId, [stay.bedId]);

        // An erroneous stay occupied nothing: every segment becomes an empty interval, so
        // it never stands in the way of a backdated occupancy of its beds.
        await tx
          .update(admissionBedStays)
          .set({ endedAt: sql`${admissionBedStays.startedAt}` })
          .where(
            and(
              eq(admissionBedStays.orgId, scope.orgId),
              eq(admissionBedStays.admissionId, row.id),
            ),
          );

        const [updated] = await tx
          .update(admissions)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelReason: input.reason,
            revision: sql`${admissions.revision} + 1`,
            updatedAt: now,
          })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
          .returning(admissionSelection);

        return admissionView(updated!, null);
      });

      audit({
        action: "ipd.cancel",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `admission:${admission.id}`,
        meta: { reason: input.reason },
      });

      return admission;
    },
  ),
};

// Cancellation erases a stay; once care was charged or medicine issued, discharge it.
async function requireNoCare(tx: Tx, orgId: string, admissionId: string) {
  const charged = tx
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.orgId, orgId),
        eq(charges.admissionId, admissionId),
        ne(charges.status, "voided"),
      ),
    );

  const issued = tx
    .select({ id: admissionPharmacyIssues.id })
    .from(admissionPharmacyIssues)
    .where(
      and(
        eq(admissionPharmacyIssues.orgId, orgId),
        eq(admissionPharmacyIssues.admissionId, admissionId),
      ),
    );

  const {
    rows: [care],
  } = await tx.execute<{ found: boolean }>(
    sql`select exists (${charged}) or exists (${issued}) as found`,
  );

  if (care?.found) {
    throw new ORPCError("CONFLICT", {
      message: "Care was already charged to this admission. Discharge it instead.",
    });
  }
}

async function hasPendingCharges(tx: Tx, orgId: string, admissionId: string) {
  const [pending] = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.orgId, orgId),
        eq(charges.admissionId, admissionId),
        eq(charges.status, "pending"),
      ),
    )
    .limit(1);

  return pending !== undefined;
}
