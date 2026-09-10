import { z } from "zod";
import { emergencyContactRelation, guardianRelation } from "@hms/api/lib/schemas";

// Every native input and select hands back a string, so form values are strings and
// the schema is what turns them into what the API stores.

/** Blank means "not recorded", not an empty string. */
export function optionalText<T extends z.ZodType<unknown, string>>(value: T) {
  return z
    .string()
    .transform((raw) => raw.trim() || null)
    .pipe(value.nullable());
}

export function numberText<T extends z.ZodNumber>(value: T) {
  return z
    .string()
    .refine((raw) => raw.trim() !== "", "Enter a number")
    .transform(Number)
    .pipe(value);
}

/** Blank means "not set", not zero. */
export function optionalNumberText<T extends z.ZodNumber>(value: T) {
  return z
    .string()
    .transform((raw) => (raw.trim() === "" ? null : Number(raw)))
    .pipe(value.nullable());
}

export const patientFieldSchema = z.object({
  name: z.string().trim().min(1, "Enter the patient's name").max(200),
  phone: z.string().trim().min(4, "Enter at least 4 characters").max(20),
  sex: z
    .string()
    .min(1, "Choose sex")
    .pipe(z.enum(["male", "female", "other", "unknown"])),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
  dobEstimated: z.boolean(),
  address: z.string().trim().max(500),
  email: optionalText(z.email("Enter a valid email address")),
  bloodGroup: optionalText(z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])),
  allergies: optionalText(z.string()),
  medicalHistory: optionalText(z.string()),
  uid: optionalText(z.string().max(100)),
  // A group left entirely blank is "not recorded"; touch one input and the rest apply.
  guardian: z
    .object({ relation: z.string(), name: z.string().trim(), phone: z.string().trim() })
    .transform((group) => (group.relation || group.name || group.phone ? group : null))
    .pipe(
      z
        .object({
          relation: z.string().min(1, "Choose the relation").pipe(guardianRelation),
          name: z.string().min(1, "Enter the guardian's name").max(200),
          phone: optionalText(z.string().min(4, "Enter at least 4 characters").max(20)),
        })
        .nullable(),
    ),
  emergencyContact: z
    .object({ name: z.string().trim(), phone: z.string().trim(), relation: z.string() })
    .transform((group) => (group.name || group.phone || group.relation ? group : null))
    .pipe(
      z
        .object({
          name: z.string().min(1, "Enter their name").max(200),
          phone: z.string().min(4, "Enter at least 4 characters").max(20),
          relation: optionalText(emergencyContactRelation),
        })
        .nullable(),
    ),
});

export type PatientFields = z.output<typeof patientFieldSchema>;
