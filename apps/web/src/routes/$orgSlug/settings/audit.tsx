import { Badge } from "@hms/ui/components/badge";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";

import { DataList, ListState, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
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
      <PageHeader title="Audit" />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <Panel grow footer={<LoadMore query={audit} shown={entries.length} />}>
          <ListState
            query={audit}
            errorTitle="Could not load the audit trail"
            isEmpty={entries.length === 0}
            empty={
              <span className="flex flex-col items-center gap-2">
                <ScrollTextIcon className="size-5" />
                <span>No activity recorded yet</span>
              </span>
            }
          >
            <DataList
              columns={[
                {
                  head: "When",
                  cell: (entry) => (
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDateTime(entry.createdAt, timeZone)}
                    </span>
                  ),
                  className: "w-36",
                },
                {
                  head: "Action",
                  cell: (entry) => (
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{entry.action}</span>
                      {entry.denied && <Badge variant="destructive">denied</Badge>}
                    </span>
                  ),
                  className: "w-32",
                  mobile: "title",
                },
                {
                  head: "Actor",
                  cell: (entry) => (
                    <span className="text-muted-foreground">
                      {entry.actorName ? (
                        <>
                          <span className="block truncate text-foreground">{entry.actorName}</span>
                          <span className="block truncate">{entry.actorEmail}</span>
                        </>
                      ) : (
                        <span className="font-mono">{entry.actorId}</span>
                      )}
                    </span>
                  ),
                  className: "w-40",
                },
                {
                  head: "Target",
                  cell: (entry) => (
                    <span className="break-all font-mono text-muted-foreground">
                      {entry.target ?? "—"}
                    </span>
                  ),
                  className: "w-96",
                },
                {
                  head: "Details",
                  cell: (entry) => (
                    <span className="break-words text-muted-foreground">
                      {describeMeta(entry.meta)}
                    </span>
                  ),
                },
              ]}
              rows={entries}
              rowKey={(entry) => String(entry.id)}
            />
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
