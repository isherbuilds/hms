import { Badge } from "@hms/ui/components/badge";
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

import { ListState, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

// `staleTime: 0`: every sensitive mutation writes here, so the trail refetches on
// every entry rather than relying on each mutation to invalidate it.
const auditQuery = (orgSlug: string) =>
  orpc.audit.list.infiniteOptions({
    input: (cursor: number | undefined) => ({ orgSlug, cursor, limit: 50 }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });

function describeMeta(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return "—";

  const details = Object.entries(meta).map(([key, value]) => {
    const formatted =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
    return `${key}=${formatted}`;
  });

  return details.length > 0 ? details.join(" · ") : "—";
}

export const Route = createFileRoute("/$orgSlug/settings/audit")({
  head: () => ({ meta: [{ title: "Audit log · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { audit: ["read"] }, "/$orgSlug/settings");
    await queryClient.infiniteQuery(auditQuery(orgSlug)).catch(() => {});
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
        <Panel label="Entries" footer={<LoadMore query={audit} shown={entries.length} />}>
          <ListState
            query={audit}
            errorTitle="Could not load the audit trail"
            isEmpty={entries.length === 0}
            empty={
              <span className="flex flex-col items-center gap-2">
                <ScrollTextIcon className="size-5" />
                <p className="max-w-sm">
                  Nothing recorded yet. Actions and denials land here as they happen.
                </p>
              </span>
            }
          >
            {/* Fixed columns: file targets run past 100 characters, so an auto
                layout would hand them the row. Target keeps a UUID on one line
                and wraps longer ids; Details takes the rest and wraps. */}
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">When</TableHead>
                  <TableHead className="w-32">Action</TableHead>
                  <TableHead className="w-40">Actor</TableHead>
                  <TableHead className="w-96">Target</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const details = describeMeta(entry.meta);

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
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
                          is matching a row against a document. It wraps, never
                          truncates. */}
                      <TableCell className="break-all font-mono text-muted-foreground">
                        {entry.target ?? "—"}
                      </TableCell>
                      {/* Prose, not an identifier, so no mono. It wraps: the
                          amounts and numbers here are why someone opens the log. */}
                      <TableCell className="break-words text-muted-foreground">{details}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
