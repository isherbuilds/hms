import { createFileRoute } from "@tanstack/react-router";

import { PageBody, PageHeader } from "@/components/page";
import { PharmacySaleDesk } from "@/components/pharmacy-sale-desk";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/pharmacy/new")({
  head: () => ({ meta: [{ title: "New sale · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // The desk exists to record a sale, so reading the shelf is not enough to open it.
    await requireOrgPermission(queryClient, orgSlug, { pharmacy: ["sell"] }, "/$orgSlug/pharmacy");
  },
  component: NewPharmacySaleRoute,
});

// No tab strip: the desk is a task opened from the sales list, like OPD intake.
function NewPharmacySaleRoute() {
  const { orgSlug } = Route.useParams();
  const { today } = useOrgDateTime();

  return (
    <>
      <PageHeader title="New sale" />
      <PageBody className="mx-auto w-full max-w-6xl pb-24 lg:pb-4">
        <p className="text-muted-foreground">{formatBusinessDate(today)}</p>
        <PharmacySaleDesk orgSlug={orgSlug} />
      </PageBody>
    </>
  );
}
