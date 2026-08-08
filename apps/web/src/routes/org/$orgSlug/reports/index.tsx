import { Link, createFileRoute } from "@tanstack/react-router";
import { ChartNoAxesColumnIncreasingIcon, LandmarkIcon, ReceiptTextIcon } from "lucide-react";

import { PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/org/$orgSlug/reports/")({
  component: ReportsIndexRoute,
});

const REPORTS = [
  {
    to: "/org/$orgSlug/reports/gst" as const,
    label: "GST outward register",
    description: "Invoices, credit notes, rate totals, and HSN/SAC totals for the selected period.",
    icon: ReceiptTextIcon,
  },
  {
    to: "/org/$orgSlug/reports/trial-balance" as const,
    label: "Trial balance",
    description: "Opening balances, period debits and credits, and closing balances by account.",
    icon: ChartNoAxesColumnIncreasingIcon,
  },
  {
    to: "/org/$orgSlug/reports/balance-sheet" as const,
    label: "Billing ledger balance sheet",
    description: "Assets, liabilities, and surplus created by HMS billing activity.",
    icon: LandmarkIcon,
  },
] as const;

function ReportsIndexRoute() {
  const { orgSlug } = Route.useParams();

  return (
    <>
      <PageHeader title="Reports" description="Billing ledger and statutory handover" />
      <div className="flex flex-col gap-3 p-4 text-xs">
        <p className="text-muted-foreground">
          These reports cover transactions recorded in this HMS. Opening balances, non-billing
          activity, and final accounts remain in the accountant's books.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {REPORTS.map(({ to, label, description, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              params={{ orgSlug }}
              className="flex min-h-28 flex-col gap-2 p-3 ring-1 ring-border [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Icon className="size-3.5" />
                {label}
              </span>
              <span className="leading-relaxed text-muted-foreground">{description}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
