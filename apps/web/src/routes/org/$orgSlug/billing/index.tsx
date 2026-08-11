import { Badge } from "@hms/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";

const ALL_STATUSES = ["waiting", "in_consult", "completed", "cancelled"] as const;

export const Route = createFileRoute("/org/$orgSlug/billing/")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchQuery(
      orpc.visit.queue.queryOptions({ input: { orgSlug, statuses: [...ALL_STATUSES] } }),
    );
  },
  component: BillingIndexRoute,
});

function BillingIndexRoute() {
  const { orgSlug } = Route.useParams();
  const visits = useQuery(
    orpc.visit.queue.queryOptions({ input: { orgSlug, statuses: [...ALL_STATUSES] } }),
  );

  return (
    <>
      <PageHeader title="Billing" description="Today's visits and accounts" />
      <PageBody>
        {visits.isPending ? (
          <div
            className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground"
            aria-busy
          >
            Loading visits…
          </div>
        ) : visits.isError ? (
          <ErrorNote title="Could not load visits" detail={visits.error.message} />
        ) : visits.data.length === 0 ? (
          <div className="border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No visits today.
          </div>
        ) : (
          <div className="overflow-x-auto ring-1 ring-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Practitioner</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.data.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell>
                      <Link
                        to="/org/$orgSlug/billing/visits/$visitId"
                        params={{ orgSlug, visitId: visit.id }}
                        className="text-lg font-semibold tabular-nums underline-offset-4 hover:underline"
                      >
                        {visit.tokenNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/org/$orgSlug/billing/visits/$visitId"
                        params={{ orgSlug, visitId: visit.id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {visit.patientName}
                      </Link>
                      <p className="text-muted-foreground">{visit.patientMrn}</p>
                    </TableCell>
                    <TableCell>{visit.practitionerName}</TableCell>
                    <TableCell>
                      <Badge variant={visit.status === "cancelled" ? "destructive" : "secondary"}>
                        {visit.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
