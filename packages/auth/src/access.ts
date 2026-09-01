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
  billing: ["read", "write", "creditNote"],
  catalog: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read"],
  file: ["upload", "read", "delete"],
} as const);

// `admin` and `owner` read as duplicates and must stay that way: they spread
// different Better Auth bases (`ownerAc` alone grants `organization:delete`), so
// sharing one body would silently move org deletion between them.
export const member = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write"],
  catalog: ["read"],
  staff: ["read"],
  settings: ["read"],
  report: ["read"],
  file: ["upload", "read"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  catalog: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read"],
  file: ["upload", "read", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  catalog: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read"],
  file: ["upload", "read", "delete"],
});

export const roles = { owner, admin, member } as const;

export type RoleKey = keyof typeof roles;

export const ORG_ROLES = ["owner", "admin", "member"] as const satisfies readonly RoleKey[];

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
  return parsed as RoleKey[];
}

export function authorize(memberRoles: readonly RoleKey[], permission: AppPermission): boolean {
  return memberRoles.some((role) => roles[role].authorize(permission).success);
}
