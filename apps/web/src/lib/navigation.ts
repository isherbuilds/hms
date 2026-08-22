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

/**
 * Every permanent destination in an organization, in one module.
 *
 * These render in four different places — the sidebar, the settings tab strip,
 * the reports hub, and the onboarding checklist — so this is one *source of
 * truth*, not one visual list. Each export below is a section with its own
 * shape; what they share is the entry type and the permission that gates it.
 * A new page means adding one line to the section it belongs to.
 */
type NavEntry<Route extends string> = {
  to: Route;
  label: string;
  permission: AppPermission;
};

/** Sidebar groups, in the order the day runs. */
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

/**
 * No entry's path is a prefix of another's, so the router's default prefix
 * matching highlights exactly one item — including while a child route like
 * `/opd/$appointmentId/billing` is open. Keep it that way: nesting a second
 * sidebar entry under an existing one is what made "Front desk" and "Queue"
 * both light up at once.
 */
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  {
    to: "/$orgSlug/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    group: "Care",
    permission: { member: ["read"] },
  },
  // ADR 0022: each built care setting gets its own destination. The route stays
  // `/opd` so staff terminology, navigation, and URLs do not drift apart.
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

/**
 * Settings is one destination in the sidebar, not five. Everything an operator
 * configures rather than works in lives behind its layout.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    to: "/$orgSlug/settings/organization",
    label: "Organization",
    // Read is org-wide, but the page is a save form — surface it only to
    // the roles that can actually save.
    permission: { settings: ["update"] },
  },
  { to: "/$orgSlug/settings/members", label: "Members", permission: { member: ["read"] } },
  { to: "/$orgSlug/settings/staff", label: "Staff", permission: { staff: ["update"] } },
  { to: "/$orgSlug/settings/catalog", label: "Catalog", permission: { catalog: ["update"] } },
  { to: "/$orgSlug/settings/audit", label: "Audit", permission: { audit: ["read"] } },
];

/**
 * Settings stays reachable for anyone who can open at least one tab, so the
 * entry does not vanish for a role that can read members but not save settings.
 */
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
