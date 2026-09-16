import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { treatmentPlanItems } from "@hms/db/schema/treatment-plan-items";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { advanceRemaining } from "../lib/advance-credit";
import { businessDate } from "../lib/business-date";
import { impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, likePattern, money, note, pageLimit, reason, searchQuery } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";
import { planLabel } from "../lib/treatment-label";

const planItemInput = z.object({
  catalogItemId: z.string(),
  qtyPlanned: z.number().int().min(1).max(999),
  unitPrice: money.optional(),
  note,
});

const planIdInput = orgInput.extend({ planId: z.string() });

const postedQty = sql<number>`coalesce(sum(${charges.qty}) filter (where ${charges.status} <> 'voided'), 0)::int`;

function planItemCharges(orgId: string) {
  return and(
    eq(charges.orgId, orgId),
    eq(charges.sourceType, "treatment_plan"),
    eq(charges.sourceId, treatmentPlanItems.id),
  );
}

async function preparePlanItem(
  orgId: string,
  planId: string,
  actorId: string,
  input: z.infer<typeof planItemInput>,
  now: Date,
) {
  const [item] = await db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.orgId, orgId),
        eq(catalogItems.id, input.catalogItemId),
        eq(catalogItems.active, true),
        eq(catalogItems.category, "procedure"),
      ),
    )
    .limit(1);

  if (!item) {
    throw new ORPCError("NOT_FOUND", { message: "That service is not available." });
  }

  const unitPrice = input.unitPrice ?? item.unitPrice;

  if (unitPrice !== item.unitPrice && !input.note) {
    throw new ORPCError("BAD_REQUEST", { message: `Add a note for ${item.name}'s price.` });
  }

  return {
    id: Bun.randomUUIDv7(),
    orgId,
    treatmentPlanId: planId,
    catalogItemId: item.id,
    description: item.name,
    unitPrice,
    taxRatePercent: item.taxRatePercent,
    taxCode: item.taxCode,
    revenueCategory: item.category,
    qtyPlanned: input.qtyPlanned,
    note: input.note ?? null,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof treatmentPlanItems.$inferInsert;
}

/** A booked or checked-in visit of the plan's patient becomes a sitting; anything else is stale. */
async function linkSitting(
  executor: typeof db | DbTransaction,
  orgId: string,
  appointmentId: string,
  plan: { id: string; patientId: string },
) {
  const [appointment] = await executor
    .update(opdAppointments)
    .set({ treatmentPlanId: plan.id, updatedAt: new Date() })
    .where(
      and(
        eq(opdAppointments.orgId, orgId),
        eq(opdAppointments.id, appointmentId),
        eq(opdAppointments.patientId, plan.patientId),
        inArray(opdAppointments.status, ["booked", "checked_in"]),
        isNull(opdAppointments.treatmentPlanId),
      ),
    )
    .returning();

  if (!appointment) {
    throw new ORPCError("CONFLICT", { message: "That visit cannot be a sitting of this plan." });
  }

  return appointment;
}

export const treatmentRouter = {
  create: orgProcedure(
    { treatment: ["create"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      /** The visit that becomes the plan's first sitting. */
      appointmentId: z.string().optional(),
      item: planItemInput,
      nextSittingOn: dateOnly.optional(),
      nextSittingNote: note,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const planId = Bun.randomUUIDv7();
    const now = new Date();

    const [[patient], [practitioner], itemRow] = await Promise.all([
      db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
        .limit(1),
      db
        .select({ id: practitioners.id })
        .from(practitioners)
        .where(
          and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, input.practitionerId)),
        )
        .limit(1),
      preparePlanItem(scope.orgId, planId, scope.userId, input.item, now),
    ]);

    if (!patient || !practitioner) {
      throw new ORPCError("NOT_FOUND", {
        message: "That patient or practitioner is not available.",
      });
    }

    return db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(treatmentPlans)
        .values({
          id: planId,
          orgId: scope.orgId,
          patientId: patient.id,
          practitionerId: practitioner.id,
          nextSittingOn: input.nextSittingOn ?? null,
          nextSittingNote: input.nextSittingNote ?? null,
          createdBy: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!plan) throw impossible("treatment plan insert returned no row");

      await tx.insert(treatmentPlanItems).values(itemRow);

      if (input.appointmentId) await linkSitting(tx, scope.orgId, input.appointmentId, plan);

      return plan;
    });
  }),

  addItem: orgProcedure(
    { treatment: ["create"] },
    planIdInput.extend({ item: planItemInput }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const row = await preparePlanItem(
      scope.orgId,
      input.planId,
      scope.userId,
      input.item,
      new Date(),
    );

    return db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ id: treatmentPlans.id })
        .from(treatmentPlans)
        .where(
          and(
            eq(treatmentPlans.orgId, scope.orgId),
            eq(treatmentPlans.id, input.planId),
            eq(treatmentPlans.status, "open"),
          ),
        )
        .limit(1)
        .for("update");

      if (!plan) {
        throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer open." });
      }

      const [inserted] = await tx.insert(treatmentPlanItems).values(row).returning();

      if (!inserted) throw impossible("treatment item insert returned no row");

      return inserted;
    });
  }),

  dropItem: orgProcedure(
    { treatment: ["update"] },
    orgInput.extend({ itemId: z.string(), reason }),
  ).handler(async ({ context, input }) => {
    const { orgId, userId } = context.scope;

    const item = await db.transaction(async (tx) => {
      // The plan lock queues this drop behind a concurrent close or completion. Items lock
      // before plans, the order `postToVisit` takes them in, so the two cannot deadlock.
      const [open] = await tx
        .select({ id: treatmentPlanItems.id })
        .from(treatmentPlanItems)
        .innerJoin(
          treatmentPlans,
          and(
            eq(treatmentPlans.orgId, orgId),
            eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId),
            eq(treatmentPlans.status, "open"),
          ),
        )
        .where(and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.id, input.itemId)))
        .limit(1)
        .for("update", { of: [treatmentPlanItems, treatmentPlans] });

      if (!open) return undefined;

      const [dropped] = await tx
        .update(treatmentPlanItems)
        .set({ status: "dropped", dropReason: input.reason, updatedAt: new Date() })
        .where(
          and(
            eq(treatmentPlanItems.orgId, orgId),
            eq(treatmentPlanItems.id, open.id),
            eq(treatmentPlanItems.status, "open"),
          ),
        )
        .returning();

      return dropped;
    });

    if (!item) {
      throw new ORPCError("CONFLICT", { message: "That item or plan is no longer open." });
    }

    audit({
      action: "treatment.dropItem",
      actorId: userId,
      orgId,
      target: `treatmentItem:${item.id}`,
      meta: { reason: input.reason },
    });

    return item;
  }),

  setNextSitting: orgProcedure(
    { treatment: ["update"] },
    planIdInput.extend({
      nextSittingOn: dateOnly.nullable(),
      note: z.string().trim().max(500).nullable(),
    }),
  ).handler(async ({ context, input }) => {
    const [plan] = await db
      .update(treatmentPlans)
      .set({
        nextSittingOn: input.nextSittingOn,
        nextSittingNote: input.note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(treatmentPlans.orgId, context.scope.orgId),
          eq(treatmentPlans.id, input.planId),
          eq(treatmentPlans.status, "open"),
        ),
      )
      .returning();

    if (!plan) {
      throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer open." });
    }

    return plan;
  }),

  linkVisit: orgProcedure(
    { treatment: ["update"] },
    planIdInput.extend({ appointmentId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    return db.transaction(async (tx) => {
      // Appointment before plan, the order `postToVisit` locks them in (D038).
      await tx
        .select({ id: opdAppointments.id })
        .from(opdAppointments)
        .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, input.appointmentId)))
        .for("update");

      const [plan] = await tx
        .select({ id: treatmentPlans.id, patientId: treatmentPlans.patientId })
        .from(treatmentPlans)
        .where(
          and(
            eq(treatmentPlans.orgId, orgId),
            eq(treatmentPlans.id, input.planId),
            eq(treatmentPlans.status, "open"),
          ),
        )
        .limit(1)
        .for("update");

      if (!plan) {
        throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer open." });
      }

      return linkSitting(tx, orgId, input.appointmentId, plan);
    });
  }),

  postToVisit: orgProcedure(
    { billing: ["write"] },
    orgInput.extend({
      itemId: z.string(),
      appointmentId: z.string(),
      // One charge per item per sitting, so a sitting that delivers two units says so here.
      qty: z.number().int().min(1).max(999).default(1),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();
    const chargeId = Bun.randomUUIDv7();

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ appointment: opdAppointments, item: treatmentPlanItems, plan: treatmentPlans })
        .from(opdAppointments)
        .innerJoin(
          treatmentPlanItems,
          and(eq(treatmentPlanItems.orgId, scope.orgId), eq(treatmentPlanItems.id, input.itemId)),
        )
        .innerJoin(
          treatmentPlans,
          and(
            eq(treatmentPlans.orgId, scope.orgId),
            eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId),
          ),
        )
        .where(
          and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, input.appointmentId)),
        )
        .limit(1)
        // The item and plan rows too: two posts of one item must not both pass the quantity check.
        .for("update", { of: [opdAppointments, treatmentPlanItems, treatmentPlans] });

      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: "That visit or treatment item no longer exists.",
        });
      }

      if (row.appointment.status !== "checked_in") {
        throw new ORPCError("CONFLICT", { message: "Only a checked-in visit can receive work." });
      }

      if (row.plan.status !== "open" || row.item.status !== "open") {
        throw new ORPCError("CONFLICT", { message: "That treatment item is no longer open." });
      }

      if (row.appointment.patientId !== row.plan.patientId) {
        throw new ORPCError("CONFLICT", { message: "This visit belongs to another patient." });
      }

      if (row.appointment.treatmentPlanId && row.appointment.treatmentPlanId !== row.plan.id) {
        throw new ORPCError("CONFLICT", { message: "This visit is linked to another plan." });
      }

      // Identity is the plan item: an ordinary charge for the same service stays separate
      // work, and the desk voids it if it was this delivery (D038).
      const [posted] = await tx
        .select({
          qty: postedQty,
          onVisit: sql<boolean>`coalesce(bool_or(${charges.opdAppointmentId} = ${row.appointment.id} and ${charges.status} <> 'voided'), false)`,
        })
        .from(charges)
        .where(
          and(
            eq(charges.orgId, scope.orgId),
            eq(charges.sourceType, "treatment_plan"),
            eq(charges.sourceId, row.item.id),
          ),
        );

      if (posted?.onVisit) {
        throw new ORPCError("CONFLICT", {
          message: `${row.item.description} is already posted to this visit.`,
        });
      }

      if ((posted?.qty ?? 0) + input.qty > row.item.qtyPlanned) {
        throw new ORPCError("CONFLICT", { message: "That would exceed the planned quantity." });
      }

      const [inserted] = await tx
        .insert(charges)
        .values({
          id: chargeId,
          orgId: scope.orgId,
          opdAppointmentId: row.appointment.id,
          catalogItemId: row.item.catalogItemId,
          description: row.item.description,
          unitPrice: row.item.unitPrice,
          taxRatePercent: row.item.taxRatePercent,
          taxCode: row.item.taxCode,
          revenueCategory: row.item.revenueCategory,
          qty: input.qty,
          sourceType: "treatment_plan",
          sourceId: row.item.id,
          createdBy: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!inserted) throw impossible("treatment charge insert returned no row");

      const [appointment] = await tx
        .update(opdAppointments)
        .set({
          treatmentPlanId: row.plan.id,
          chargeRevision: sql`${opdAppointments.chargeRevision} + 1`,
        })
        .where(
          and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, row.appointment.id)),
        )
        .returning({ chargeRevision: opdAppointments.chargeRevision });

      if (!appointment) throw impossible("locked appointment vanished before versioning");

      return { charge: inserted, chargeRevision: appointment.chargeRevision };
    });

    audit({
      action: "treatment.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `charge:${chargeId}`,
      meta: { treatmentItemId: input.itemId, appointmentId: input.appointmentId },
    });

    return result;
  }),

  complete: orgProcedure({ treatment: ["update"] }, planIdInput).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      return db.transaction(async (tx) => {
        const [plan] = await tx
          .select({ id: treatmentPlans.id })
          .from(treatmentPlans)
          .where(
            and(
              eq(treatmentPlans.orgId, orgId),
              eq(treatmentPlans.id, input.planId),
              eq(treatmentPlans.status, "open"),
            ),
          )
          .limit(1)
          .for("update");

        if (!plan) {
          throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer open." });
        }

        const rows = await tx
          .select({
            status: treatmentPlanItems.status,
            qtyPlanned: treatmentPlanItems.qtyPlanned,
            postedQty,
          })
          .from(treatmentPlanItems)
          .leftJoin(charges, planItemCharges(orgId))
          .where(
            and(
              eq(treatmentPlanItems.orgId, orgId),
              eq(treatmentPlanItems.treatmentPlanId, plan.id),
            ),
          )
          .groupBy(treatmentPlanItems.id);

        if (rows.some((item) => item.status !== "dropped" && item.postedQty < item.qtyPlanned)) {
          throw new ORPCError("CONFLICT", {
            message: "Post or drop every planned item before completion.",
          });
        }

        const now = new Date();

        const [completed] = await tx
          .update(treatmentPlans)
          .set({ status: "completed", completedAt: now, updatedAt: now })
          .where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.id, plan.id)))
          .returning();

        if (!completed) throw impossible("locked treatment plan vanished before completion");

        return completed;
      });
    },
  ),

  close: orgProcedure({ treatment: ["update"] }, planIdInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();

      const [plan] = await db
        .update(treatmentPlans)
        .set({ status: "closed", closeReason: input.reason, closedAt: now, updatedAt: now })
        .where(
          and(
            eq(treatmentPlans.orgId, scope.orgId),
            eq(treatmentPlans.id, input.planId),
            eq(treatmentPlans.status, "open"),
          ),
        )
        .returning();

      if (!plan) {
        throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer open." });
      }

      audit({
        action: "treatment.close",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `treatment:${plan.id}`,
        meta: { reason: input.reason },
      });

      return plan;
    },
  ),

  /** Every plan of one patient, open ones first: the single plan read the record screens share. */
  listForPatient: orgProcedure(
    { treatment: ["read"] },
    orgInput.extend({ patientId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const [[patient], plans] = await Promise.all([
      db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.orgId, orgId), eq(patients.id, input.patientId)))
        .limit(1),
      db
        // Spelled out because this list is the payload: a whole plan row would ship
        // `orgId` and the rest of the tenant's bookkeeping to the browser.
        .select({
          plan: {
            id: treatmentPlans.id,
            status: treatmentPlans.status,
            nextSittingOn: treatmentPlans.nextSittingOn,
            nextSittingNote: treatmentPlans.nextSittingNote,
            closeReason: treatmentPlans.closeReason,
          },
          label: planLabel(orgId),
          practitionerName: practitioners.name,
        })
        .from(treatmentPlans)
        .innerJoin(
          practitioners,
          and(eq(practitioners.orgId, orgId), eq(practitioners.id, treatmentPlans.practitionerId)),
        )
        .where(and(eq(treatmentPlans.orgId, orgId), eq(treatmentPlans.patientId, input.patientId)))
        .orderBy(
          sql`${treatmentPlans.status} = 'open' desc`,
          desc(treatmentPlans.createdAt),
          desc(treatmentPlans.id),
        ),
    ]);

    if (!patient) {
      throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
    }

    if (plans.length === 0) return [];

    const planIds = plans.map(({ plan }) => plan.id);

    const [itemRows, sittingRows] = await Promise.all([
      db
        .select({
          planId: treatmentPlanItems.treatmentPlanId,
          item: {
            id: treatmentPlanItems.id,
            catalogItemId: treatmentPlanItems.catalogItemId,
            description: treatmentPlanItems.description,
            note: treatmentPlanItems.note,
            status: treatmentPlanItems.status,
            qtyPlanned: treatmentPlanItems.qtyPlanned,
            unitPrice: treatmentPlanItems.unitPrice,
          },
          postedQty,
        })
        .from(treatmentPlanItems)
        .leftJoin(charges, planItemCharges(orgId))
        .where(
          and(
            eq(treatmentPlanItems.orgId, orgId),
            inArray(treatmentPlanItems.treatmentPlanId, planIds),
          ),
        )
        .groupBy(treatmentPlanItems.id)
        .orderBy(asc(treatmentPlanItems.createdAt), asc(treatmentPlanItems.id)),
      db
        .select({ planId: opdAppointments.treatmentPlanId, id: opdAppointments.id })
        .from(opdAppointments)
        .where(
          and(
            eq(opdAppointments.orgId, orgId),
            inArray(opdAppointments.treatmentPlanId, planIds),
            eq(opdAppointments.status, "checked_in"),
          ),
        )
        .orderBy(asc(opdAppointments.arrivedAt), asc(opdAppointments.id)),
    ]);

    const itemsByPlan = Map.groupBy(itemRows, (row) => row.planId);
    const sittingsByPlan = Map.groupBy(sittingRows, (row) => row.planId);

    return plans.map(({ plan, label, practitionerName }) => {
      const items = (itemsByPlan.get(plan.id) ?? []).map((row) => ({
        ...row.item,
        postedQty: row.postedQty,
        done: row.postedQty >= row.item.qtyPlanned,
      }));

      return {
        ...plan,
        label,
        practitionerName,
        items,
        sittings: (sittingsByPlan.get(plan.id) ?? []).map(({ id }) => ({ id })),
        quotedTotal: items
          .filter((item) => item.status !== "dropped")
          .reduce((sum, item) => sum + BigInt(item.qtyPlanned) * item.unitPrice, 0n),
      };
    });
  }),

  followUps: orgProcedure(
    { treatment: ["read"] },
    orgInput.extend({
      query: searchQuery,
      cursor: z
        .object({
          nextSittingOn: dateOnly.nullable(),
          lastSittingOn: dateOnly.nullable(),
          id: z.string(),
        })
        .optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const today = businessDate(new Date(), timeZone);
    const pattern = input.query ? likePattern(input.query) : undefined;
    const cursorNext = input.cursor?.nextSittingOn ?? "9999-12-31";
    const cursorLast = input.cursor?.lastSittingOn ?? "0001-01-01";

    const result = await db.execute<{
      id: string;
      patientId: string;
      patientName: string;
      patientMrn: string;
      patientPhone: string;
      label: string;
      practitionerName: string;
      sittingsDone: number;
      lastSittingOn: string | null;
      nextSittingOn: string | null;
      nextSittingNote: string | null;
      creditHeld: string;
    }>(sql`
      select treatment_plans.id,
             treatment_plans.patient_id as "patientId",
             p.name as "patientName",
             p.mrn as "patientMrn",
             p.phone as "patientPhone",
             ${planLabel(orgId)} as "label",
             pr.name as "practitionerName",
             count(done.id)::int as "sittingsDone",
             max(done.business_date)::text as "lastSittingOn",
             treatment_plans.next_sitting_on::text as "nextSittingOn",
             treatment_plans.next_sitting_note as "nextSittingNote",
             coalesce((
               select sum(${advanceRemaining(orgId)}) from ${advanceReceipts}
               where ${advanceReceipts.orgId} = ${orgId}
                 and ${advanceReceipts.treatmentPlanId} = treatment_plans.id
             ), 0)::bigint as "creditHeld"
      from treatment_plans
      join patients p on p.org_id = ${orgId} and p.id = treatment_plans.patient_id
      join practitioners pr on pr.org_id = ${orgId} and pr.id = treatment_plans.practitioner_id
      left join opd_appointments done on done.org_id = ${orgId}
        and done.treatment_plan_id = treatment_plans.id and done.status = 'checked_in'
      where treatment_plans.org_id = ${orgId}
        and treatment_plans.status = 'open'
        and not exists (
          select 1 from opd_appointments booked
          where booked.org_id = ${orgId}
            and booked.treatment_plan_id = treatment_plans.id and booked.status = 'booked'
            and booked.business_date >= ${today}::date
        )
        and (treatment_plans.next_sitting_on <= ${today}::date or treatment_plans.next_sitting_on is null)
        and (${pattern ?? null}::text is null or p.name ilike ${pattern ?? ""} escape '\\'
             or p.mrn ilike ${pattern ?? ""} escape '\\'
             or p.phone ilike ${pattern ?? ""} escape '\\')
      group by treatment_plans.id, p.id, pr.id
      having (${input.cursor === undefined}
        or (coalesce(treatment_plans.next_sitting_on, '9999-12-31'::date), coalesce(max(done.business_date), '0001-01-01'::date), treatment_plans.id)
          > (${cursorNext}::date, ${cursorLast}::date, ${input.cursor?.id ?? ""}))
      order by treatment_plans.next_sitting_on asc nulls last, max(done.business_date) asc nulls first, treatment_plans.id
      limit ${input.limit + 1}
    `);

    const rows = result.rows
      .slice(0, input.limit)
      .map((row) => ({ ...row, creditHeld: BigInt(row.creditHeld) }));

    const last = rows.at(-1);

    return {
      items: rows,
      nextCursor:
        result.rows.length > input.limit && last
          ? { nextSittingOn: last.nextSittingOn, lastSittingOn: last.lastSittingOn, id: last.id }
          : null,
    };
  }),
};
