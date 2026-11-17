import type { DbTransaction } from "@hms/db/counter";
import { admissions, type AdmissionStatus } from "@hms/db/schema/ipd";
import { patients } from "@hms/db/schema/patients";
import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { impossible } from "./conflict";

export const expectedChargeRevision = z.number().int().nonnegative();

/**
 * Locks an Admission for a change to its Charge set (D020): issues, services and the
 * bill. Not the lifecycle `lockAdmission`, which compares the stay's own revision.
 */
export async function lockAdmissionCharges(tx: DbTransaction, orgId: string, admissionId: string) {
  const [row] = await tx
    .select({
      id: admissions.id,
      status: admissions.status,
      chargeRevision: admissions.chargeRevision,
      patient: {
        id: patients.id,
        name: patients.name,
        mrn: patients.mrn,
        phone: patients.phone,
        address: patients.address,
        guardianRelation: patients.guardianRelation,
        guardianName: patients.guardianName,
      },
    })
    .from(admissions)
    .innerJoin(patients, and(eq(patients.orgId, orgId), eq(patients.id, admissions.patientId)))
    .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admissionId)))
    .limit(1)
    .for("update", { of: admissions });

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "That admission no longer exists." });
  }

  return row;
}

type LockedAdmission = Awaited<ReturnType<typeof lockAdmissionCharges>>;

/** Status and the reviewed revision, checked under the Admission lock. */
export function requireChargeable(
  admission: LockedAdmission,
  rule: { allowed: readonly AdmissionStatus[]; message: string; expectedChargeRevision: number },
) {
  if (!rule.allowed.includes(admission.status)) {
    throw new ORPCError("CONFLICT", { message: rule.message });
  }

  if (admission.chargeRevision !== rule.expectedChargeRevision) {
    throw new ORPCError("CONFLICT", {
      message: "The charges changed. Review the bill and try again",
    });
  }
}

export async function bumpChargeRevision(tx: DbTransaction, orgId: string, admissionId: string) {
  const [row] = await tx
    .update(admissions)
    .set({ chargeRevision: sql`${admissions.chargeRevision} + 1` })
    .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admissionId)))
    .returning({ chargeRevision: admissions.chargeRevision });

  if (!row) throw impossible("locked admission vanished before versioning");

  return row.chargeRevision;
}

/** An issued medicine's bill line: batch and expiry travel with the Charge to the Invoice. */
export function admissionIssueDescription(batch: {
  name: string;
  batchNumber: string;
  expiryDate: string | null;
}): string {
  const base = `${batch.name} · batch ${batch.batchNumber}`;

  if (batch.expiryDate === null) return base;

  const [year, month] = batch.expiryDate.split("-");

  return `${base} · exp ${month}/${year}`;
}
