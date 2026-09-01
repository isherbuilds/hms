import { z } from "zod";

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
