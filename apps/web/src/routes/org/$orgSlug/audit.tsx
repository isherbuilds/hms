import { Badge } from "@better-stack/ui/components/badge";
import { Button } from "@better-stack/ui/components/button";
import { Empty, EmptyHeader } from "@better-stack/ui/components/empty";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-stack/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { orpc } from "@/lib/orpc";

const auditQuery = (orgSlug: string) =>
  orpc.audit.list.infiniteOptions({
    input: (cursor: number | undefined) => ({ orgSlug, cursor, limit: 50 }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/org/$orgSlug/audit")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchInfiniteQuery(auditQuery(orgSlug));
  },
  component: AuditRoute,
});

const timestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function AuditRoute() {
  const { orgSlug } = Route.useParams();
  const audit = useInfiniteQuery(auditQuery(orgSlug));

  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Audit"
        description="Sensitive actions and every permission denial in this organization."
      />

      <div className="p-4">
        {audit.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        ) : audit.isError ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <p className="text-sm font-medium">Could not load the audit trail</p>
              <p className="text-xs text-muted-foreground">{audit.error.message}</p>
            </EmptyHeader>
            <Button variant="outline" onClick={() => audit.refetch()}>
              Try again
            </Button>
          </Empty>
        ) : entries.length === 0 ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <ScrollTextIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing recorded yet</p>
              <p className="text-xs text-muted-foreground">
                Destructive actions and denied requests will appear here as they happen.
              </p>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="ring-1 ring-border">
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
                        {timestamp.format(new Date(entry.createdAt))}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
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
                          <span className="font-mono text-[0.6875rem]">{entry.actorId}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.target ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {audit.hasNextPage && (
              <Button
                variant="outline"
                className="self-start"
                disabled={audit.isFetchingNextPage}
                onClick={() => audit.fetchNextPage()}
              >
                {audit.isFetchingNextPage ? "Loading…" : "Load older entries"}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
