import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Single source of truth for the application's permissions.
 *
 * This module is intentionally dependency-free (no db, no env) so it can be
 * imported from the server (Better Auth config, oRPC middleware) *and* the
 * client (organizationClient) without pulling Node-only code into the bundle.
 */
export const ac = createAccessControl({
  ...defaultStatements,
  // `member` is Better Auth's own statement; "read" is ours, so that everyone
  // in an org can see who else is in it while only admins can change it.
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  // `opd` is the current care domain. Future settings add their own subject when
  // their domain ships rather than widening today's permission vocabulary.
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  catalog: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read"],
  file: ["upload", "read", "delete"],
} as const);

// Each role spreads the Better Auth defaults first, then states this app's
// grants explicitly. Permissions are the last place to be clever about
// inheritance — a reader should see a role's full surface in one block.
//
// `admin` and `owner` read as duplicates and must stay that way: they spread
// *different* Better Auth bases (`ownerAc` alone grants `organization:delete`),
// so sharing one body would silently move org deletion between them.
//
// `member: ["create"]` is not the gate for adding a person — `member.invite`
// checks `invitation: ["create"]`, and Better Auth's own member endpoints check
// only `update`/`delete`. It is kept because this object is also handed to the
// organization plugin, so it defines the shared vocabulary, not just our guards.
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

/** Display order, most privileged first. Drives role pickers and validation. */
export const ORG_ROLES = ["owner", "admin", "member"] as const satisfies readonly RoleKey[];

export type AppPermission = Parameters<typeof roles.admin.authorize>[0];

/**
 * Better Auth stores a member's roles comma-joined (`updateMemberRole` accepts
 * an array) and authorizes them as a *union* — one role granting the
 * permission is enough. Mirror that exactly rather than reading the first
 * entry, and reject a role this app does not define instead of silently
 * downgrading it to `member`.
 */
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
