import { authorize } from "@hms/auth/access";
import { db } from "@hms/db";
import { catalogItems } from "@hms/db/schema/catalog-items";
import {
  ACTIVE_ADMISSION_STATUSES,
  admissionBedStays,
  admissions,
  bedCategories,
  bedTariffs,
  beds,
  wards,
  type AdmissionStatus,
} from "@hms/db/schema/ipd";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { impossible } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure, type Scope } from "../lib/procedures/factory";
import { money, pageLimit, reason, shortName } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A desk entry a few minutes late is ordinary; anything older is a correction that
// needs `ipd:correct` and a reason, and is audited.
const BACKDATE_TOLERANCE_MS = 10 * 60 * 1_000;

const AWAITING_CLEANING = "Awaiting cleaning after discharge";

type Effective = { at: Date; backdated: boolean };

function effectiveTime(scope: Scope, requested: Date | undefined, why: string | undefined) {
  const now = new Date();
  const at = requested ?? now;

  if (at.getTime() > now.getTime()) {
    throw new ORPCError("BAD_REQUEST", { message: "That time is in the future." });
  }

  const backdated = now.getTime() - at.getTime() > BACKDATE_TOLERANCE_MS;

  if (backdated) {
    if (!authorize(scope.roles, { ipd: ["correct"] })) {
      audit({
        action: "rbac.permission",
        denied: true,
        actorId: scope.userId,
        orgId: scope.orgId,
        meta: { roles: scope.roles, permission: { ipd: ["correct"] } },
      });
      throw new ORPCError("FORBIDDEN", {
        message: "Only an administrator can record an earlier time.",
      });
    }

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
  patientId: admissions.patientId,
  practitionerId: admissions.practitionerId,
  status: admissions.status,
  admittedAt: admissions.admittedAt,
  readyAt: admissions.readyAt,
  dischargedAt: admissions.dischargedAt,
  cancelledAt: admissions.cancelledAt,
  cancelReason: admissions.cancelReason,
  revision: admissions.revision,
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

// Locks beds in id order so two transfers touching the same pair cannot deadlock.
async function lockBeds(tx: Tx, orgId: string, bedIds: string[]) {
  const ordered = [...new Set(bedIds)].sort();

  const rows = await tx
    .select({
      id: beds.id,
      categoryId: beds.categoryId,
      active: beds.active,
      blockedAt: beds.blockedAt,
    })
    .from(beds)
    .where(and(eq(beds.orgId, orgId), inArray(beds.id, ordered)))
    .orderBy(asc(beds.id))
    .for("update");

  return new Map(rows.map((row) => [row.id, row]));
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
        eq(admissionBedStays.orgId, orgId),
        eq(admissionBedStays.bedId, bed.id),
        ne(admissions.status, "cancelled"),
        or(isNull(admissionBedStays.endedAt), gt(admissionBedStays.endedAt, from)),
      ),
    )
    .limit(1);

  if (clash) {
    throw new ORPCError("CONFLICT", { message: "That bed is occupied for that time." });
  }
}

async function tariffAt(tx: Tx, orgId: string, categoryId: string, at: Date) {
  const [tariff] = await tx
    .select({ id: bedTariffs.id, dailyPrice: bedTariffs.dailyPrice })
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

  throw error;
}

function nameConflict(error: unknown, what: string): never {
  if (uniqueViolationConstraint(error) !== undefined) {
    throw new ORPCError("CONFLICT", { message: `${what} already exists.` });
  }

  throw error;
}

async function requireInScope<T>(promise: Promise<T[]>, message: string): Promise<T> {
  const [row] = await promise;

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message });
  }

  return row;
}

function auditBackdate(
  scope: Scope,
  action: string,
  admissionId: string,
  effective: Effective,
  why?: string,
) {
  if (!effective.backdated) return;

  audit({
    action,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `admission:${admissionId}`,
    meta: { effectiveAt: effective.at.toISOString(), reason: why },
  });
}

const transitionInput = orgInput.extend({
  admissionId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
});

const ADMISSION_STATES = {
  current: ["admitted", "discharge_ready"],
  past: ["discharged", "cancelled"],
} as const;

export const ipdRouter = {
  facility: orgProcedure({ ipd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const now = new Date();

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
      db
        .select({
          id: bedTariffs.id,
          categoryId: bedTariffs.categoryId,
          catalogItemId: bedTariffs.catalogItemId,
          serviceName: catalogItems.name,
          dailyPrice: bedTariffs.dailyPrice,
          effectiveFrom: bedTariffs.effectiveFrom,
        })
        .from(bedTariffs)
        .innerJoin(
          catalogItems,
          and(
            eq(catalogItems.orgId, bedTariffs.orgId),
            eq(catalogItems.id, bedTariffs.catalogItemId),
          ),
        )
        .where(eq(bedTariffs.orgId, orgId))
        .orderBy(desc(bedTariffs.effectiveFrom), desc(bedTariffs.id)),
    ]);

    return {
      wards: wardRows,
      categories: categoryRows.map((category) => {
        const tariffs = tariffRows.filter((tariff) => tariff.categoryId === category.id);

        return {
          ...category,
          currentTariff: tariffs.find((tariff) => tariff.effectiveFrom <= now) ?? null,
          tariffs,
        };
      }),
      beds: bedRows,
    };
  }),

  createWard: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ name: shortName }),
  ).handler(async ({ context, input }) => {
    try {
      const [ward] = await db
        .insert(wards)
        .values({ id: Bun.randomUUIDv7(), orgId: context.scope.orgId, name: input.name })
        .returning({ id: wards.id, name: wards.name });

      return ward!;
    } catch (error) {
      nameConflict(error, "A ward with this name");
    }
  }),

  createBedCategory: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ name: shortName }),
  ).handler(async ({ context, input }) => {
    try {
      const [category] = await db
        .insert(bedCategories)
        .values({ id: Bun.randomUUIDv7(), orgId: context.scope.orgId, name: input.name })
        .returning({ id: bedCategories.id, name: bedCategories.name });

      return category!;
    } catch (error) {
      nameConflict(error, "A bed category with this name");
    }
  }),

  setBedTariff: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({
      categoryId: z.string(),
      catalogItemId: z.string(),
      dailyPrice: money,
      effectiveFrom: z.date(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    await Promise.all([
      requireInScope(
        db
          .select({ id: bedCategories.id })
          .from(bedCategories)
          .where(and(eq(bedCategories.orgId, scope.orgId), eq(bedCategories.id, input.categoryId)))
          .limit(1),
        "That bed category no longer exists.",
      ),
      requireInScope(
        db
          .select({ id: catalogItems.id })
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.orgId, scope.orgId),
              eq(catalogItems.id, input.catalogItemId),
              eq(catalogItems.active, true),
            ),
          )
          .limit(1),
        "That service no longer exists.",
      ),
    ]);

    const id = Bun.randomUUIDv7();

    const [tariff] = await db
      .insert(bedTariffs)
      .values({
        id,
        orgId: scope.orgId,
        categoryId: input.categoryId,
        catalogItemId: input.catalogItemId,
        dailyPrice: input.dailyPrice,
        effectiveFrom: input.effectiveFrom,
        createdBy: scope.userId,
      })
      .returning();

    audit({
      action: "ipd.tariff.set",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed_category:${input.categoryId}`,
      meta: {
        tariffId: id,
        catalogItemId: input.catalogItemId,
        dailyPrice: input.dailyPrice.toString(),
        effectiveFrom: input.effectiveFrom.toISOString(),
      },
    });

    return tariff!;
  }),

  createBed: orgProcedure(
    { ipd: ["manageFacility"] },
    orgInput.extend({ wardId: z.string(), categoryId: z.string(), label: shortName }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

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

    try {
      const [bed] = await db
        .insert(beds)
        .values({
          id: Bun.randomUUIDv7(),
          orgId,
          wardId: input.wardId,
          categoryId: input.categoryId,
          label: input.label,
        })
        .returning();

      return bed!;
    } catch (error) {
      nameConflict(error, "A bed with this label in that ward");
    }
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

    const bed = await db.transaction(async (tx) => {
      const locked = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

      if (!locked) {
        throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
      }

      await assertUnoccupied(tx, scope.orgId, input.bedId);

      const [updated] = await tx
        .update(beds)
        .set({ blockedAt: new Date(), blockedReason: input.reason, updatedAt: new Date() })
        .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
        .returning();

      return updated!;
    });

    audit({
      action: "ipd.bed.block",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `bed:${input.bedId}`,
      meta: { reason: input.reason },
    });

    return bed;
  }),

  releaseBed: orgProcedure({ ipd: ["update"] }, orgInput.extend({ bedId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;

      return db.transaction(async (tx) => {
        const locked = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

        if (!locked) {
          throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
        }

        await assertUnoccupied(tx, scope.orgId, input.bedId);

        const [updated] = await tx
          .update(beds)
          .set({ blockedAt: null, blockedReason: null, updatedAt: new Date() })
          .where(and(eq(beds.orgId, scope.orgId), eq(beds.id, input.bedId)))
          .returning();

        return updated!;
      });
    },
  ),

  bedBoard: orgProcedure({ ipd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const rows = await db
      .select({
        id: beds.id,
        label: beds.label,
        wardId: wards.id,
        wardName: wards.name,
        categoryName: bedCategories.name,
        blockedAt: beds.blockedAt,
        blockedReason: beds.blockedReason,
        admissionId: admissions.id,
        admissionStatus: admissions.status,
        admittedAt: admissions.admittedAt,
        revision: admissions.revision,
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

    return {
      beds: rows.map((row) => {
        const admission =
          row.admissionId && row.admissionStatus && row.admittedAt && row.patientId
            ? {
                id: row.admissionId,
                status: row.admissionStatus,
                admittedAt: row.admittedAt,
                revision: row.revision ?? 0,
                patientId: row.patientId,
                patientName: row.patientName ?? "",
                mrn: row.mrn ?? "",
                practitionerName: row.practitionerName ?? "",
              }
            : null;

        return {
          id: row.id,
          label: row.label,
          wardId: row.wardId,
          wardName: row.wardName,
          categoryName: row.categoryName,
          status: admission
            ? ("occupied" as const)
            : row.blockedAt
              ? ("blocked" as const)
              : ("available" as const),
          blockedReason: row.blockedReason,
          admission,
        };
      }),
    };
  }),

  list: orgProcedure(
    { ipd: ["read"] },
    orgInput.extend({
      state: z.enum(["current", "past", "all"]).default("current"),
      // Admission ids are UUIDv7, so the id alone is a chronological keyset.
      cursor: z.string().optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const items = await db
      .select({
        id: admissions.id,
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
          input.state === "all"
            ? undefined
            : inArray(admissions.status, ADMISSION_STATES[input.state]),
          input.cursor ? lt(admissions.id, input.cursor) : undefined,
        ),
      )
      .orderBy(desc(admissions.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;

    if (hasNextPage) {
      items.pop();
    }

    return { items, nextCursor: hasNextPage ? (items.at(-1)?.id ?? null) : null };
  }),

  get: orgProcedure({ ipd: ["read"] }, orgInput.extend({ admissionId: z.string() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const [row] = await db
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

      const stays = await db
        .select({
          id: admissionBedStays.id,
          bedId: admissionBedStays.bedId,
          bedLabel: beds.label,
          wardName: wards.name,
          dailyPrice: admissionBedStays.dailyPrice,
          startedAt: admissionBedStays.startedAt,
          endedAt: admissionBedStays.endedAt,
        })
        .from(admissionBedStays)
        .innerJoin(
          beds,
          and(eq(beds.orgId, admissionBedStays.orgId), eq(beds.id, admissionBedStays.bedId)),
        )
        .innerJoin(wards, and(eq(wards.orgId, beds.orgId), eq(wards.id, beds.wardId)))
        .where(and(eq(admissionBedStays.orgId, orgId), eq(admissionBedStays.admissionId, row.id)))
        .orderBy(asc(admissionBedStays.startedAt), asc(admissionBedStays.id));

      const { patientName, mrn, practitionerName, ...admission } = row;
      const current = stays.find((stay) => stay.endedAt === null);

      return {
        admission: admissionView(admission, current?.bedId ?? null),
        patient: { id: admission.patientId, name: patientName, mrn },
        practitionerName,
        stays,
      };
    },
  ),

  admit: orgProcedure(
    { ipd: ["create"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      bedId: z.string(),
      admittedAt: z.date().optional(),
      reason: reason.optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.admittedAt, input.reason);
    const { timeZone } = await readOrgSettings(scope.orgId);

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

    const admission = await db
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

        const [active] = await tx
          .select({ id: admissions.id })
          .from(admissions)
          .where(
            and(
              eq(admissions.orgId, scope.orgId),
              eq(admissions.patientId, input.patientId),
              inArray(admissions.status, ACTIVE_ADMISSION_STATUSES),
            ),
          )
          .limit(1);

        if (active) {
          throw new ORPCError("CONFLICT", { message: "This Patient is already admitted." });
        }

        const bed = (await lockBeds(tx, scope.orgId, [input.bedId])).get(input.bedId);

        if (!bed) {
          throw new ORPCError("NOT_FOUND", { message: "That bed no longer exists." });
        }

        await assertBedFree(tx, scope.orgId, bed, effective.at);
        const tariff = await tariffAt(tx, scope.orgId, bed.categoryId, effective.at);

        const id = Bun.randomUUIDv7();

        const [created] = await tx
          .insert(admissions)
          .values({
            id,
            orgId: scope.orgId,
            patientId: input.patientId,
            practitionerId: input.practitionerId,
            status: "admitted",
            admittedAt: effective.at,
            timeZone,
            createdBy: scope.userId,
          })
          .returning(admissionSelection);

        await tx.insert(admissionBedStays).values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          admissionId: id,
          bedId: bed.id,
          tariffId: tariff.id,
          dailyPrice: tariff.dailyPrice,
          startedAt: effective.at,
          createdBy: scope.userId,
        });

        return admissionView(created!, bed.id);
      })
      .catch(occupancyConflict);

    auditBackdate(scope, "ipd.admit.backdate", admission.id, effective, input.reason);

    return admission;
  }),

  transferBed: orgProcedure(
    { ipd: ["update"] },
    transitionInput.extend({ bedId: z.string(), ...effectiveInput }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const effective = effectiveTime(scope, input.effectiveAt, input.reason);

    const admission = await db
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
        const tariff = await tariffAt(tx, scope.orgId, destination.categoryId, effective.at);

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
          dailyPrice: tariff.dailyPrice,
          startedAt: effective.at,
          createdBy: scope.userId,
        });

        const [updated] = await tx
          .update(admissions)
          .set({ revision: sql`${admissions.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
          .returning(admissionSelection);

        return admissionView(updated!, destination.id);
      })
      .catch(occupancyConflict);

    auditBackdate(scope, "ipd.transfer.backdate", admission.id, effective, input.reason);

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

      if (effective.at.getTime() < row.admittedAt.getTime()) {
        throw new ORPCError("BAD_REQUEST", { message: "That time is before the admission." });
      }

      const stay = await openStay(tx, scope.orgId, row.id);

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
  discharge: orgProcedure({ ipd: ["update"] }, transitionInput.extend(effectiveInput)).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const effective = effectiveTime(scope, input.effectiveAt, input.reason);

      const admission = await db.transaction(async (tx) => {
        const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
        requireStatus(row, ["discharge_ready"], "Mark the Patient ready for discharge first.");

        const stay = await openStay(tx, scope.orgId, row.id);
        requireNotBeforeStay(effective.at, stay);
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
            revision: sql`${admissions.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(admissions.orgId, scope.orgId), eq(admissions.id, row.id)))
          .returning(admissionSelection);

        return admissionView(updated!, null);
      });

      auditBackdate(scope, "ipd.discharge.backdate", admission.id, effective, input.reason);

      return admission;
    },
  ),

  // Reverses an erroneous Admission. Once care was delivered, discharge instead.
  cancel: orgProcedure({ ipd: ["correct"] }, transitionInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();

      const admission = await db.transaction(async (tx) => {
        const row = await lockAdmission(tx, scope.orgId, input.admissionId, input.expectedRevision);
        requireStatus(row, ACTIVE_ADMISSION_STATUSES, "This admission has already ended.");

        const stay = await openStay(tx, scope.orgId, row.id);
        await lockBeds(tx, scope.orgId, [stay.bedId]);

        await tx
          .update(admissionBedStays)
          .set({ endedAt: sql`greatest(${admissionBedStays.startedAt}, ${now})` })
          .where(and(eq(admissionBedStays.orgId, scope.orgId), eq(admissionBedStays.id, stay.id)));

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

async function assertUnoccupied(tx: Tx, orgId: string, bedId: string) {
  const [stay] = await tx
    .select({ id: admissionBedStays.id })
    .from(admissionBedStays)
    .where(
      and(
        eq(admissionBedStays.orgId, orgId),
        eq(admissionBedStays.bedId, bedId),
        isNull(admissionBedStays.endedAt),
      ),
    )
    .limit(1);

  if (stay) {
    throw new ORPCError("CONFLICT", { message: "That bed is occupied." });
  }
}
