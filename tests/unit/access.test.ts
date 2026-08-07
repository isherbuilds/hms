import { expect, test } from "bun:test";

import {
  ORG_ROLES,
  authorize,
  parseRoles,
  roles,
  type AppPermission,
  type RoleKey,
} from "@better-stack/auth/access";

/**
 * The role/permission matrix is the whole point of the authorization layer and
 * costs nothing to check, so it is asserted exhaustively rather than sampled.
 * `true` means the role must hold the permission, `false` means it must not.
 */
const MATRIX: Array<{
  permission: AppPermission;
  owner: boolean;
  admin: boolean;
  member: boolean;
}> = [
  { permission: { settings: ["read"] }, owner: true, admin: true, member: true },
  {
    permission: { settings: ["update"] },
    owner: true,
    admin: true,
    member: false,
  },

  { permission: { audit: ["read"] }, owner: true, admin: true, member: false },

  { permission: { ai: ["use"] }, owner: true, admin: true, member: true },

  { permission: { catalog: ["read"] }, owner: true, admin: true, member: true },
  {
    permission: { catalog: ["create"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { catalog: ["update"] },
    owner: true,
    admin: true,
    member: false,
  },

  { permission: { staff: ["read"] }, owner: true, admin: true, member: true },
  {
    permission: { staff: ["create"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { staff: ["update"] },
    owner: true,
    admin: true,
    member: false,
  },

  {
    permission: { storage: ["upload"] },
    owner: true,
    admin: true,
    member: true,
  },
  { permission: { storage: ["read"] }, owner: true, admin: true, member: true },
  {
    permission: { storage: ["delete"] },
    owner: true,
    admin: true,
    member: false,
  },

  { permission: { member: ["read"] }, owner: true, admin: true, member: true },
  {
    permission: { member: ["create"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { member: ["update"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { member: ["delete"] },
    owner: true,
    admin: true,
    member: false,
  },

  {
    permission: { invitation: ["create"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { invitation: ["cancel"] },
    owner: true,
    admin: true,
    member: false,
  },

  {
    permission: { organization: ["update"] },
    owner: true,
    admin: true,
    member: false,
  },
  {
    permission: { organization: ["delete"] },
    owner: true,
    admin: false,
    member: false,
  },
];

test("each role grants exactly the permissions the matrix declares", () => {
  // The matrix only means anything if it covers every role the app defines —
  // `satisfies RoleKey[]` rejects an unknown role but not a forgotten one.
  expect([...ORG_ROLES].sort()).toEqual(Object.keys(roles).sort() as RoleKey[]);

  const granted = MATRIX.map((row) => ({
    permission: row.permission,
    owner: authorize(["owner"], row.permission),
    admin: authorize(["admin"], row.permission),
    member: authorize(["member"], row.permission),
  }));

  // One assertion over the whole matrix: a mismatch prints the offending row
  // next to its expectation instead of a bare `true !== false`.
  expect(granted).toEqual(MATRIX);
});

test("parseRoles reads every stored role and rejects ones this app does not define", () => {
  expect(parseRoles("member,admin")).toEqual(["member", "admin"]);
  expect(parseRoles(" owner , member ")).toEqual(["owner", "member"]);

  expect(() => parseRoles("superadmin")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("member,superadmin")).toThrow(/Unknown organization role/);
});

test("authorize grants the union across roles, matching Better Auth's own semantics", () => {
  // The bug this guards: reading only the first role silently strips the
  // permissions a multi-role member was deliberately granted.
  expect(authorize(parseRoles("member"), { audit: ["read"] })).toBe(false);
  expect(authorize(parseRoles("member,admin"), { audit: ["read"] })).toBe(true);
  expect(authorize(parseRoles("member,admin"), { storage: ["delete"] })).toBe(true);

  expect(authorize(["member"], { organization: ["delete"] })).toBe(false);
  expect(authorize([], { settings: ["read"] })).toBe(false);
});
