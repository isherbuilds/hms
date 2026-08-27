import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";

import { SettingsTabs } from "./route";

const auditQuery = (orgSlug: string) =>
  orpc.audit.list.infiniteOptions({
    input: (cursor: number | undefined) => ({ orgSlug, cursor, limit: 50 }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/settings/audit")({
  head: () => ({ meta: [{ title: "Audit log · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.prefetchInfiniteQuery(auditQuery(orgSlug));
  },
  component: AuditRoute,
});

function AuditRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const audit = useInfiniteQuery(auditQuery(orgSlug));

  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Audit"
        description="Sensitive actions and every permission denial in this organization"
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        {/* One tray for the trail, in the same shell as the OPD day list
            (docs/design.md §1), so the two boards read as one product. */}
        <section className="flex flex-col rounded-xl bg-muted p-1">
          <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
            <span className="min-w-0 truncate">Entries</span>
          </div>
          {/* The card holds its height through a pending read, a failed one and
              an organization that has recorded nothing yet. */}
          <div className="min-h-32 overflow-hidden rounded-lg border border-border bg-card">
            {audit.isPending ? null : audit.isError ? (
              <div className="flex min-h-32 flex-col items-start justify-center gap-3 p-4">
                <ErrorNote title="Could not load the audit trail" detail={audit.error.message} />
                <Button variant="outline" size="xs" onClick={() => audit.refetch()}>
                  Try again
                </Button>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                <ScrollTextIcon className="size-5" />
                <p className="max-w-sm">
                  Nothing recorded yet. Actions and denials land here as they happen.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(entry.createdAt, timeZone)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{entry.action}</span>
                          {entry.denied && <Badge variant="destructive">denied</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.actorName ? (
                          <>
                            <div className="truncate text-foreground">{entry.actorName}</div>
                            <div className="truncate">{entry.actorEmail}</div>
                          </>
                        ) : (
                          // The account is gone; the entry deliberately survives it.
                          <span className="font-mono">{entry.actorId}</span>
                        )}
                      </TableCell>
                      {/* `entity:id`, read character by character when someone
                          is matching a row against a document. */}
                      <TableCell className="font-mono text-muted-foreground">
                        {entry.target ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Under the list only: every other state is the card's business. */}
        {!audit.isError && entries.length > 0 && audit.hasNextPage ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={audit.isFetchingNextPage}
            onClick={() => audit.fetchNextPage()}
          >
            {audit.isFetchingNextPage ? "Loading…" : "Load older entries"}
          </Button>
        ) : null}
      </PageBody>
    </>
  );
}
