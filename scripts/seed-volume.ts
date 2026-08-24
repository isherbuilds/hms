import { db } from "@hms/db";
import { organization } from "@hms/db/schema/auth";
import { CATALOG_CATEGORIES, catalogItems } from "@hms/db/schema/catalog-items";
import { counter } from "@hms/db/schema/counter";
import { SETTINGS_DEFAULTS, organizationSettings } from "@hms/db/schema/organization-settings";
import { patients } from "@hms/db/schema/patients";
import { env } from "@hms/env/server";
import { count, eq, inArray, sql } from "drizzle-orm";

/**
 * Deterministic development volume for patient search and catalog benchmarks.
 * Run the normal seed first, then run `bun scripts/seed-volume.ts` from the repo root.
 */

const ORG_SLUGS = ["mercy-general", "ridgeview-academy"] as const;
const PATIENT_COUNT = 20_000;
const CATALOG_ITEM_COUNT = 1_000;
const BATCH_SIZE = 1_000;
const ALREADY_SEEDED_THRESHOLD = 10_000;
const FIXED_SEED = 0x5eed_2026;
const ANCHOR_DATE = new Date("2026-08-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

const GIVEN_NAMES = [
  "Aarav",
  "Aditi",
  "Aditya",
  "Akash",
  "Ananya",
  "Anika",
  "Anil",
  "Aradhya",
  "Arjun",
  "Bhavna",
  "Charu",
  "Deepak",
  "Devika",
  "Divya",
  "Gaurav",
  "Harish",
  "Ishaan",
  "Ishita",
  "Jaya",
  "Karan",
  "Kavita",
  "Kiran",
  "Kranti",
  "Lakshmi",
  "Manish",
  "Meera",
  "Mohan",
  "Nandini",
  "Neha",
  "Nikhil",
  "Pooja",
  "Prachi",
  "Pradeep",
  "Prakash",
  "Pranav",
  "Priya",
  "Rahul",
  "Rajesh",
  "Rani",
  "Ravi",
  "Rohit",
  "Sanjay",
  "Shravan",
  "Sneha",
  "Suraj",
  "Tanvi",
  "Varsha",
  "Vijay",
  "Viraj",
  "Zoya",
] as const;

const FAMILY_NAMES = [
  "Agarwal",
  "Ahuja",
  "Bajaj",
  "Banerjee",
  "Batra",
  "Bhat",
  "Bose",
  "Chandra",
  "Chatterjee",
  "Chauhan",
  "Chopra",
  "Das",
  "Desai",
  "Deshmukh",
  "Dutta",
  "Gandhi",
  "Gill",
  "Goswami",
  "Gupta",
  "Iyer",
  "Jain",
  "Joshi",
  "Kapoor",
  "Kaur",
  "Khanna",
  "Kumar",
  "Kulkarni",
  "Malhotra",
  "Mehta",
  "Menon",
  "Mishra",
  "Mukherjee",
  "Nair",
  "Pandey",
  "Patel",
  "Prasad",
  "Raghavan",
  "Rajan",
  "Rana",
  "Rao",
  "Raut",
  "Reddy",
  "Roy",
  "Saxena",
  "Shah",
  "Sharma",
  "Singh",
  "Sinha",
  "Trivedi",
  "Verma",
] as const;

const LOCALITIES = [
  "Ashok Nagar",
  "Banjara Hills",
  "Civil Lines",
  "Gandhi Road",
  "Indira Nagar",
  "Lake View",
  "MG Road",
  "Rajendra Nagar",
] as const;
const CITIES = ["Bengaluru", "Chennai", "Delhi", "Hyderabad", "Kolkata", "Mumbai", "Pune"] as const;
const SEXES = ["male", "female", "other", "unknown"] as const;
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const TAX_RATES = ["0", "5", "12", "18"] as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Build a deterministic UUIDv7 with a fixed timestamp and a unique 48-bit tail. */
function deterministicUuidV7(
  date: Date,
  random: () => number,
  namespace: number,
  orgIndex: number,
  rowIndex: number,
): string {
  const timestamp = BigInt(date.getTime()).toString(16).padStart(12, "0");
  const randomA = (((random() * 4_294_967_296) >>> 0) & 0x0fff).toString(16).padStart(3, "0");
  const randomB = ((((random() * 4_294_967_296) >>> 0) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  const uniqueTail =
    (BigInt(namespace & 0xff) << 40n) | (BigInt(orgIndex & 0xff) << 32n) | BigInt(rowIndex + 1);

  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${randomA}-${randomB}-${uniqueTail
    .toString(16)
    .padStart(12, "0")}`;
}

function patientCreatedAt(random: () => number): Date {
  const offset = Math.floor(random() * 365 * DAY_MS);
  return new Date(ANCHOR_DATE.getTime() - offset);
}

function dateOfBirth(index: number): string {
  const year = 1940 + (index % 75);
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String((index % 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function patientPhone(index: number, orgIndex: number): string {
  const firstDigit = 6 + ((index + orgIndex) % 4);
  const subscriber = orgIndex * PATIENT_COUNT + index;
  return `${firstDigit}${String(subscriber).padStart(9, "0")}`;
}

type OrganizationSeed = {
  id: string;
  slug: (typeof ORG_SLUGS)[number];
  orgIndex: number;
};

type SeedSummary = {
  slug: string;
  patientsInserted: number;
  catalogItemsInserted: number;
  elapsedMs: number;
};

async function resolveOrganizations(): Promise<OrganizationSeed[]> {
  const rows = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(inArray(organization.slug, ORG_SLUGS));
  const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const missing = ORG_SLUGS.filter((slug) => !bySlug.has(slug));

  if (missing.length > 0) {
    throw new Error(
      `Missing required organization(s): ${missing.join(", ")}. Run \`bun run db:seed\` first.`,
    );
  }

  return ORG_SLUGS.map((slug, orgIndex) => ({
    id: bySlug.get(slug)!,
    slug,
    orgIndex,
  }));
}

async function readMrnPrefix(orgId: string): Promise<string> {
  const [settings] = await db
    .select({ mrnPrefix: organizationSettings.mrnPrefix })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);
  return settings?.mrnPrefix ?? SETTINGS_DEFAULTS.mrnPrefix;
}

async function seedOrganization(org: OrganizationSeed): Promise<SeedSummary> {
  const startedAt = performance.now();
  const mrnPrefix = await readMrnPrefix(org.id);
  const random = mulberry32(FIXED_SEED + org.orgIndex);

  const inserted = await db.transaction(async (tx) => {
    // Serialize concurrent volume seeds for the same organization before the count gate.
    await tx.execute(
      sql`select ${organization.id} from ${organization} where ${organization.id} = ${org.id} for update`,
    );

    const [existing] = await tx
      .select({ value: count() })
      .from(patients)
      .where(eq(patients.orgId, org.id));
    const existingPatientCount = existing?.value ?? 0;

    if (existingPatientCount > ALREADY_SEEDED_THRESHOLD) {
      console.info(
        `${org.slug}: found ${existingPatientCount} patients; skipping volume seed for this organization.`,
      );
      return { patientsInserted: 0, catalogItemsInserted: 0 };
    }

    // This is the batched equivalent of PATIENT_COUNT calls to nextCounter.
    const [sequence] = await tx
      .insert(counter)
      .values({ orgId: org.id, key: "mrn", value: PATIENT_COUNT })
      .onConflictDoUpdate({
        target: [counter.orgId, counter.key],
        set: { value: sql`${counter.value} + ${PATIENT_COUNT}` },
      })
      .returning({ finalValue: counter.value });

    if (!sequence) {
      throw new Error(`MRN counter update returned no row for organization "${org.slug}"`);
    }

    const firstSequence = sequence.finalValue - PATIENT_COUNT + 1;
    for (let start = 0; start < PATIENT_COUNT; start += BATCH_SIZE) {
      const rows: (typeof patients.$inferInsert)[] = [];
      for (let offset = 0; offset < BATCH_SIZE; offset += 1) {
        const index = start + offset;
        const createdAt = patientCreatedAt(random);
        const givenName = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)]!;
        const familyName = FAMILY_NAMES[Math.floor(random() * FAMILY_NAMES.length)]!;
        const sequenceNumber = firstSequence + index;

        rows.push({
          id: deterministicUuidV7(createdAt, random, 1, org.orgIndex, index),
          orgId: org.id,
          mrn: `${mrnPrefix}${String(sequenceNumber).padStart(6, "0")}`,
          name: `${givenName} ${familyName}`,
          phone: patientPhone(index, org.orgIndex),
          sex: SEXES[index % SEXES.length]!,
          dateOfBirth: dateOfBirth(index),
          ageYears: null,
          address: `${(index % 240) + 1}, ${LOCALITIES[index % LOCALITIES.length]}, ${CITIES[index % CITIES.length]}`,
          email: null,
          bloodGroup: BLOOD_GROUPS[index % BLOOD_GROUPS.length]!,
          allergies: null,
          medicalHistory: null,
          uid: String(100_000_000_000 + org.orgIndex * PATIENT_COUNT + index),
          createdBy: null,
          createdAt,
          updatedAt: createdAt,
        });
      }
      await tx.insert(patients).values(rows);
    }

    for (let start = 0; start < CATALOG_ITEM_COUNT; start += BATCH_SIZE) {
      const rows: (typeof catalogItems.$inferInsert)[] = [];
      const end = Math.min(start + BATCH_SIZE, CATALOG_ITEM_COUNT);
      for (let index = start; index < end; index += 1) {
        const category = CATALOG_CATEGORIES[index % CATALOG_CATEGORIES.length]!;
        const createdAt = new Date(ANCHOR_DATE.getTime() - (index % 365) * DAY_MS);
        rows.push({
          id: deterministicUuidV7(createdAt, random, 2, org.orgIndex, index),
          orgId: org.id,
          name: `${category[0]!.toUpperCase()}${category.slice(1)} Service ${String(index + 1).padStart(4, "0")}`,
          code: `VOL-${category.slice(0, 3).toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
          category,
          unitPrice: (100 + ((index * 137) % 9_900)).toFixed(2),
          taxRatePercent: TAX_RATES[index % TAX_RATES.length]!,
          taxCode: index % 3 === 0 ? null : `SAC${998_300 + (index % 100)}`,
          active: index < 400,
          createdAt,
          updatedAt: createdAt,
        });
      }
      await tx.insert(catalogItems).values(rows);
    }

    return {
      patientsInserted: PATIENT_COUNT,
      catalogItemsInserted: CATALOG_ITEM_COUNT,
    };
  });

  return {
    slug: org.slug,
    ...inserted,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const organizations = await resolveOrganizations();
  const summaries: SeedSummary[] = [];
  for (const org of organizations) {
    summaries.push(await seedOrganization(org));
  }

  console.info("\nVolume seed summary:");
  for (const summary of summaries) {
    console.info(
      `  ${summary.slug}: ${summary.patientsInserted} patients, ${summary.catalogItemsInserted} catalog items, ${summary.elapsedMs} ms`,
    );
  }
}

await main();
process.exit(0);
