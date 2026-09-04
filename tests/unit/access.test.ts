import { expect, test } from "bun:test";

import {
  ORG_ROLES,
  authorize,
  parseRoles,
  roles,
  type AppPermission,
  type RoleKey,
} from "@hms/auth/access";

const MATRIX: Array<{ permission: AppPermission } & Record<RoleKey, boolean>> = [
  {
    permission: { settings: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { settings: ["update"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { audit: ["read"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: true,
  },
  {
    permission: { report: ["readDailyCollections"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: true,
    accountant: true,
  },
  {
    permission: { report: ["readOpdRegister"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: true,
  },
  {
    permission: { report: ["readFinancial"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: true,
  },
  {
    permission: { catalog: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { catalog: ["create"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { catalog: ["update"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { staff: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { staff: ["create"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { staff: ["update"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { file: ["upload"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: false,
    accountant: false,
  },
  {
    permission: { file: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { file: ["delete"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { member: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { member: ["create"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { member: ["update"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { member: ["delete"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { invitation: ["create"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { invitation: ["cancel"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { organization: ["update"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { organization: ["delete"] },
    owner: true,
    admin: false,
    reception: false,
    cashier: false,
    accountant: false,
  },
  {
    permission: { patient: ["create"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: false,
    accountant: false,
  },
  {
    permission: { patient: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { patient: ["update"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: false,
    accountant: false,
  },
  {
    permission: { opd: ["create"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: false,
    accountant: false,
  },
  {
    permission: { opd: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { opd: ["update"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: false,
    accountant: false,
  },
  {
    permission: { billing: ["read"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: true,
  },
  {
    permission: { billing: ["write"] },
    owner: true,
    admin: true,
    reception: true,
    cashier: true,
    accountant: false,
  },
  {
    permission: { billing: ["creditNote"] },
    owner: true,
    admin: true,
    reception: false,
    cashier: false,
    accountant: true,
  },
];

test("each role grants exactly the permissions the matrix declares", () => {
  expect([...ORG_ROLES].sort()).toEqual(Object.keys(roles).sort() as RoleKey[]);

  const granted = MATRIX.map((row) => ({
    permission: row.permission,
    owner: authorize(["owner"], row.permission),
    admin: authorize(["admin"], row.permission),
    reception: authorize(["reception"], row.permission),
    cashier: authorize(["cashier"], row.permission),
    accountant: authorize(["accountant"], row.permission),
  }));

  expect(granted).toEqual(MATRIX);
});

test("parseRoles reads every stored role and rejects ones this app does not define", () => {
  expect(parseRoles("reception,cashier")).toEqual(["reception", "cashier"]);
  expect(parseRoles(" owner , accountant ")).toEqual(["owner", "accountant"]);

  expect(() => parseRoles("member")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("superadmin")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("reception,superadmin")).toThrow(/Unknown organization role/);
});

test("authorize grants the union across roles, matching Better Auth's own semantics", () => {
  // The bug this guards: reading only the first role strips a multi-role member's
  // permissions.
  expect(authorize(parseRoles("reception"), { audit: ["read"] })).toBe(false);
  expect(authorize(parseRoles("reception,accountant"), { audit: ["read"] })).toBe(true);
  expect(authorize(parseRoles("reception,admin"), { file: ["delete"] })).toBe(true);

  expect(authorize(["reception"], { organization: ["delete"] })).toBe(false);
  expect(authorize([], { settings: ["read"] })).toBe(false);
});
