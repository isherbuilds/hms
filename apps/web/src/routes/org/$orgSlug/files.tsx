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
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, FileIcon, Trash2, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { orpc } from "@/lib/orpc";

const filesQuery = (orgSlug: string) =>
  orpc.files.list.infiniteOptions({
    input: (cursor: { createdAt: Date; id: string } | undefined) => ({
      orgSlug,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/org/$orgSlug/files")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchInfiniteQuery(filesQuery(orgSlug));
  },
  component: FilesRoute,
});

const timestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function FilesRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const files = useInfiniteQuery(filesQuery(orgSlug));

  // `files.delete` writes an audit row, so the trail is stale after one.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.files.list.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.summary.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.audit.list.key({ input: { orgSlug } }),
      }),
    ]);

  /**
   * Three steps, and the bytes never touch the app server: ask for a presigned
   * PUT, stream straight to SeaweedFS, then flip the row to `ready`. If the
   * PUT fails the row simply stays `pending` and never appears in the list.
   */
  const upload = async (file: File) => {
    setUploading(file.name);
    try {
      const { key, uploadUrl } = await orpc.files.createUpload.call({
        orgSlug,
        name: file.name,
        mimeType: file.type || undefined,
        size: file.size,
      });

      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: file.type ? { "Content-Type": file.type } : undefined,
      });
      if (!response.ok) {
        throw new Error(`Storage rejected the upload (${response.status})`);
      }

      await orpc.files.finalizeUpload.call({ orgSlug, key });
      await refresh();
      toast.success(`Uploaded ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  // Presigned URLs are cross-origin, where `download` is ignored — an anchor
  // would navigate this tab away from the app instead of downloading.
  const download = async (key: string) => {
    try {
      const { url } = await orpc.files.getReadUrl.call({ orgSlug, key });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that file");
    }
  };

  const remove = async (key: string, name: string) => {
    try {
      await orpc.files.delete.call({ orgSlug, key });
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
        description={
          files.isPending
            ? "Loading…"
            : "Stored privately. Links are signed and expire after 15 minutes."
        }
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
              <UploadIcon />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      <div className="p-4">
        {files.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        ) : files.isError ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <p className="text-sm font-medium">Could not load files</p>
              <p className="text-xs text-muted-foreground">{files.error.message}</p>
            </EmptyHeader>
            <Button variant="outline" onClick={() => files.refetch()}>
              Try again
            </Button>
          </Empty>
        ) : items.length === 0 ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <FileIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No files yet</p>
              <p className="text-xs text-muted-foreground">
                Upload one to share it with this organization.
              </p>
            </EmptyHeader>
            <Button disabled={uploading !== null} onClick={() => inputRef.current?.click()}>
              <UploadIcon />
              {uploading ? "Uploading…" : "Upload a file"}
            </Button>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
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
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatSize(file.size)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {timestamp.format(new Date(file.createdAt))}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Download ${file.name}`}
                            onClick={() => download(file.id)}
                          >
                            <DownloadIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
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
            </div>

            {files.hasNextPage && (
              <Button
                variant="outline"
                className="self-start"
                disabled={files.isFetchingNextPage}
                onClick={() => files.fetchNextPage()}
              >
                {files.isFetchingNextPage ? "Loading…" : "Load older files"}
              </Button>
            )}
          </div>
        )}
      </div>
      {confirmDialog}
    </>
  );
}
