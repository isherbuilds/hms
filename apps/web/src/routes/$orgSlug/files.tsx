import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, FileIcon, Trash2, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useConfirm } from "@/components/confirm-dialog";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";

const filesQuery = (orgSlug: string) =>
  orpc.file.list.infiniteOptions({
    input: (cursor: { createdAt: string; id: string } | undefined) => ({
      orgSlug,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/files")({
  head: () => ({ meta: [{ title: "Files · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.prefetchInfiniteQuery(filesQuery(orgSlug));
  },
  component: FilesRoute,
});

function FilesRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const files = useInfiniteQuery(filesQuery(orgSlug));

  // `file.delete` writes an audit row, so the trail is stale after one.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.file.list.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.audit.list.key({ input: { orgSlug } }),
      }),
    ]);

  const upload = async (file: File) => {
    setUploading(file.name);
    try {
      await uploadOrgFile(orgSlug, file);
      await refresh();
      toast.success(`Uploaded ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const download = async (key: string) => {
    try {
      await openOrgFile(orgSlug, key);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that file");
    }
  };

  const remove = async (key: string, name: string) => {
    try {
      await orpc.file.delete.call({ orgSlug, key });
      await refresh();
      toast.success(`Deleted ${name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that file");
    }
  };

  const items = files.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Files"
        description="Stored privately · links are signed and expire after 15 minutes"
        action={
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  upload(file);
                }
                event.target.value = "";
              }}
            />
            <Button disabled={uploading !== null} onClick={() => inputRef.current?.click()}>
              <UploadIcon data-icon="inline-start" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      <PageBody>
        {/* Every stored file in the house card-in-card language
            (docs/design.md §1): the tinted tray carries the label, the raised
            card carries the rows, and it holds its height through a pending
            read, a failed one and an organization that has uploaded nothing. */}
        <section className="flex flex-col rounded-xl bg-muted p-1">
          <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
            <span className="min-w-0 truncate">Library</span>
          </div>
          <div className="min-h-32 overflow-hidden rounded-lg border border-border bg-card">
            {files.isPending ? null : files.isError ? (
              <div className="flex min-h-32 flex-col items-start justify-center gap-3 p-4">
                <ErrorNote title="Could not load files" detail={files.error.message} />
                <Button variant="outline" size="xs" onClick={() => files.refetch()}>
                  Try again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                <FileIcon className="size-5" />
                <p>No files yet. Upload one to share it with this organization.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* The name takes the slack so the narrow columns hug
                        their content; `max-w-0` on the cell below is what lets
                        it truncate instead of widening the table. */}
                    <TableHead className="w-full">Name</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="max-w-0">
                        <div className="truncate font-medium">{file.name}</div>
                        <div className="truncate text-muted-foreground">
                          {file.mimeType ?? "unknown type"}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {formatFileSize(file.size)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(file.createdAt, timeZone)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Download ${file.name}`}
                            onClick={() => download(file.id)}
                          >
                            <DownloadIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${file.name}`}
                            onClick={() =>
                              confirm({
                                title: `Delete ${file.name}?`,
                                description:
                                  "The file and its stored object are removed permanently. This cannot be undone.",
                                confirmLabel: "Delete",
                                run: () => void remove(file.id, file.name),
                              })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Under the list only: every other state is the card's business. */}
        {!files.isError && items.length > 0 && files.hasNextPage ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={files.isFetchingNextPage}
            onClick={() => files.fetchNextPage()}
          >
            {files.isFetchingNextPage ? "Loading…" : "Load older files"}
          </Button>
        ) : null}
      </PageBody>
      {confirmDialog}
    </>
  );
}
