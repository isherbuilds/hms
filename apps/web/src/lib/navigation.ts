import type { AppPermission } from "@hms/auth/access";
import {
  Building2Icon,
  ChartColumnIcon,
  ChartNoAxesColumnIncreasingIcon,
  FileIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  ListOrderedIcon,
  ReceiptTextIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

// One source of truth, not one visual list: these render in the sidebar, the
// settings strip, the reports hub and the onboarding checklist. A new page means
// one line in the section it belongs to.
type NavEntry<Route extends string> = {
  to: Route;
  label: string;
  permission: AppPermission;
};

export const NAV_GROUPS = ["Care", "Finance", "Workspace"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export type PrimaryNavItem = NavEntry<
  | "/$orgSlug/dashboard"
  | "/$orgSlug/patients"
  | "/$orgSlug/opd"
  | "/$orgSlug/billing"
  | "/$orgSlug/reports"
  | "/$orgSlug/files"
> & { icon: LucideIcon; group: NavGroup };

// No entry's path is a prefix of another's, so prefix matching highlights exactly
// one item. Nesting a second entry under an existing one lit up both.
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  {
    to: "/$orgSlug/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    group: "Care",
    permission: { member: ["read"] },
  },
  // D013: each built care setting gets its own destination. The route stays `/opd`
  // so terminology, navigation and URLs do not drift apart.
  {
    to: "/$orgSlug/opd",
    label: "OPD",
    icon: ListOrderedIcon,
    group: "Care",
    permission: { opd: ["read"] },
  },
  {
    to: "/$orgSlug/patients",
    label: "Patients",
    icon: UsersIcon,
    group: "Care",
    permission: { patient: ["read"] },
  },
  {
    to: "/$orgSlug/billing",
    label: "Billing",
    icon: ReceiptTextIcon,
    group: "Finance",
    permission: { billing: ["read"] },
  },
  {
    to: "/$orgSlug/reports",
    label: "Reports",
    icon: ChartColumnIcon,
    group: "Finance",
    permission: { report: ["read"] },
  },
  {
    to: "/$orgSlug/files",
    label: "Files",
    icon: FileIcon,
    group: "Workspace",
    permission: { file: ["read"] },
  },
];

export type SettingsTab = NavEntry<
  | "/$orgSlug/settings/organization"
  | "/$orgSlug/settings/members"
  | "/$orgSlug/settings/staff"
  | "/$orgSlug/settings/catalog"
  | "/$orgSlug/settings/audit"
>;

export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    to: "/$orgSlug/settings/organization",
    label: "Organization",
    // Read is org-wide, but the page is a save form — surface it only to roles that
    // can actually save.
    permission: { settings: ["update"] },
  },
  { to: "/$orgSlug/settings/members", label: "Members", permission: { member: ["read"] } },
  { to: "/$orgSlug/settings/staff", label: "Staff", permission: { staff: ["update"] } },
  { to: "/$orgSlug/settings/catalog", label: "Catalog", permission: { catalog: ["update"] } },
  { to: "/$orgSlug/settings/audit", label: "Audit", permission: { audit: ["read"] } },
];

// Reachable for anyone who can open at least one tab, so the entry does not vanish
// for a role that can read members but not save settings.
export const SETTINGS_PERMISSIONS: readonly AppPermission[] = SETTINGS_TABS.map(
  ({ permission }) => permission,
);

export type ReportLink = NavEntry<
  "/$orgSlug/reports/gst" | "/$orgSlug/reports/trial-balance" | "/$orgSlug/reports/balance-sheet"
> & { icon: LucideIcon; description: string };

export const REPORT_LINKS: readonly ReportLink[] = [
  {
    to: "/$orgSlug/reports/gst",
    label: "GST outward register",
    description: "Invoices, credit notes, rate totals, and HSN/SAC totals for the selected period.",
    icon: ReceiptTextIcon,
    permission: { report: ["read"] },
  },
  {
    to: "/$orgSlug/reports/trial-balance",
    label: "Trial balance",
    description: "Opening balances, period debits and credits, and closing balances by account.",
    icon: ChartNoAxesColumnIncreasingIcon,
    permission: { report: ["read"] },
  },
  {
    to: "/$orgSlug/reports/balance-sheet",
    label: "Billing ledger balance sheet",
    description: "Assets, liabilities, and surplus created by HMS billing activity.",
    icon: LandmarkIcon,
    permission: { report: ["read"] },
  },
];

export type SetupStep = NavEntry<
  | "/$orgSlug/settings/organization"
  | "/$orgSlug/settings/members"
  | "/$orgSlug/settings/staff"
  | "/$orgSlug/settings/catalog"
> & { icon: LucideIcon; description: string };

/** The order a new organization is configured in, not the settings tab order. */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    to: "/$orgSlug/settings/organization",
    label: "Confirm hospital details",
    description: "Set the legal name, timezone, tax identity, and document numbering.",
    icon: Building2Icon,
    permission: { settings: ["update"] },
  },
  {
    to: "/$orgSlug/settings/staff",
    label: "Add departments and practitioners",
    description: "Prepare the people and departments used at registration.",
    icon: StethoscopeIcon,
    permission: { staff: ["update"] },
  },
  {
    to: "/$orgSlug/settings/catalog",
    label: "Build the service catalog",
    description: "Define billable services, prices, and tax treatment.",
    icon: ListChecksIcon,
    permission: { catalog: ["update"] },
  },
  {
    to: "/$orgSlug/settings/members",
    label: "Review the team",
    description: "See who has access and invite the people who will work here.",
    icon: UsersIcon,
    permission: { member: ["read"] },
  },
];
