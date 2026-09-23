import { PageTab, PageTabs } from "@/components/page";

export function BillingNav({ orgSlug }: { orgSlug: string }) {
  return (
    <PageTabs label="Billing sections">
      <PageTab to="/$orgSlug/billing" params={{ orgSlug }} activeOptions={{ exact: true }}>
        Open money
      </PageTab>
      <PageTab to="/$orgSlug/billing/refunds" params={{ orgSlug }}>
        Refunds due
      </PageTab>
      <PageTab to="/$orgSlug/billing/advances" params={{ orgSlug }}>
        Advances held
      </PageTab>
    </PageTabs>
  );
}
