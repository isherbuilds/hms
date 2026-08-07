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
  settings: ["read", "update"],
  audit: ["read"],
  storage: ["upload", "read", "delete"],
  ai: ["use"],
} as const);

// Each role spreads the Better Auth defaults first, then states this app's
// grants explicitly. Permissions are the last place to be clever about
// inheritance — a reader should see a role's full surface in one block.
export const member = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  patient: ["create", "read", "update"],
  settings: ["read"],
  storage: ["upload", "read"],
  ai: ["use"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  storage: ["upload", "read", "delete"],
  ai: ["use"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  member: ["create", "read", "update", "delete"],
  patient: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  storage: ["upload", "read", "delete"],
  ai: ["use"],
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
