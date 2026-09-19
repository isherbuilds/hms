import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Dependency-free (no db, no env) so server and client can both import it.
export const ac = createAccessControl({
  ...defaultStatements,
  // `member` is Better Auth's own statement; "read" is ours, so everyone in an org
  // can see who else is in it while only admins can change it.
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote", "advanceRefund"],
  pharmacy: ["read", "sell", "return", "receive", "adjust", "manageItems"],
  treatment: ["create", "read", "update"],
  catalog: ["create", "read", "update"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
} as const);

export const reception = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write"],
  pharmacy: ["read"],
  treatment: ["create", "read", "update"],
  catalog: ["read"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  file: ["upload", "read"],
});

// Cashiers close their shift from Daily Collections; patient-level and accounting
// reports stay separate.
export const cashier = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["read"],
  opd: ["read"],
  billing: ["read", "write", "advanceRefund"],
  pharmacy: ["read"],
  treatment: ["read"],
  catalog: ["read"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  report: ["readDailyCollections"],
  file: ["read"],
});

export const accountant = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["read"],
  opd: ["read"],
  billing: ["read", "creditNote", "advanceRefund"],
  pharmacy: ["read"],
  treatment: ["read"],
  catalog: ["read"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  report: ["readDailyCollections", "readOpdRegister", "readFinancial"],
  audit: ["read"],
  file: ["read"],
});

// The counter sells with its own grant and never holds `billing:write`; a supervising
// pharmacist is granted `admin` alongside it for adjustments (roles are a union).
export const pharmacist = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["read"],
  opd: ["read"],
  billing: ["read"],
  pharmacy: ["read", "sell", "return", "receive"],
  catalog: ["read"],
  settings: ["read"],
  report: ["readDailyCollections"],
  file: ["upload", "read"],
});

// `admin` and `owner` read as duplicates and must stay that way: they spread
// different Better Auth bases (`ownerAc` alone grants `organization:delete`), so
// sharing one body would silently move org deletion between them.
export const admin = ac.newRole({
  ...adminAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote", "advanceRefund"],
  pharmacy: ["read", "sell", "return", "receive", "adjust", "manageItems"],
  treatment: ["create", "read", "update"],
  catalog: ["create", "read", "update"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote", "advanceRefund"],
  pharmacy: ["read", "sell", "return", "receive", "adjust", "manageItems"],
  treatment: ["create", "read", "update"],
  catalog: ["create", "read", "update"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
});

// Better Auth merges built-in `member`/`admin`/`owner` roles into this map, but HMS
// authorizes only through `parseRoles`/`authorize`, which reject stored `member`;
// reset legacy rows per D022 before deploying.
export const roles = { owner, admin, reception, cashier, accountant, pharmacist } as const;

export type RoleKey = keyof typeof roles;

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Owner",
  admin: "Administrator",
  reception: "Reception",
  cashier: "Cashier",
  accountant: "Accountant",
  pharmacist: "Pharmacist",
};

export const ORG_ROLES = [
  "owner",
  "admin",
  "reception",
  "cashier",
  "accountant",
  "pharmacist",
] as const satisfies readonly RoleKey[];

export type AppPermission = Parameters<typeof roles.admin.authorize>[0];

// Better Auth stores roles comma-joined and authorizes them as a union, so mirror
// that rather than reading the first entry, and reject an undefined role instead of
// silently downgrading it.
export function parseRoles(stored: string): RoleKey[] {
  const parsed = stored
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  const unknown = parsed.filter((role) => !(role in roles));

  if (unknown.length > 0) {
    throw new Error(`Unknown organization role(s): ${unknown.join(", ")}`);
  }

  // SAFETY: every parsed value was checked against the complete roles map above.
  return parsed as RoleKey[];
}

export function authorize(memberRoles: readonly RoleKey[], permission: AppPermission): boolean {
  return memberRoles.some((role) => roles[role].authorize(permission).success);
}
