import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, FileIcon, Trash2, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useConfirm } from "@/components/confirm-dialog";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { formatFileSize, openOrgFile, uploadOrgFile } from "@/lib/org-files";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { useCan } from "@/lib/membership";

const filesQuery = (orgSlug: string, query: string) =>
  orpc.file.list.infiniteOptions({
    input: (cursor: { createdAt: string; id: string } | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/files")({
  head: () => ({ meta: [{ title: "Files · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(filesQuery(orgSlug, "")).catch(() => {});
  },
  component: FilesRoute,
});

function FilesRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const canDelete = useCan(orgSlug, { file: ["delete"] });
  const canUpload = useCan(orgSlug, { file: ["upload"] });

  const files = useInfiniteQuery(filesQuery(orgSlug, query));

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.file.list.key({ input: { orgSlug } }) });

  const upload = async (file: File) => {
    setUploading(file.name);

    // Cleared after the catch, not in a `finally`: React Compiler cannot lower one, and
    // it would leave this whole component unmemoized.
    try {
      await uploadOrgFile(orgSlug, file);
      await refresh();
      toast.success(`Uploaded ${file.name}`);
    } catch (error) {
      toast.error(errorMessage(error, "Upload failed"));
    }

    setUploading(null);
  };

  const download = async (key: string) => {
    try {
      await openOrgFile(orgSlug, key);
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that file"));
    }
  };

  const remove = async (key: string, name: string) => {
    try {
      await orpc.file.delete.call({ orgSlug, key });
      await refresh();
      toast.success(`Deleted ${name}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete that file"));
    }
  };

  const items = files.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Files"
        action={
          canUpload ? (
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
          ) : undefined
        }
      />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search files"
            placeholder="Search file name"
            onQueryChange={setQuery}
          />
        </ListToolbar>
        <Panel grow footer={<LoadMore query={files} shown={items.length} />}>
          <ListState
            query={files}
            errorTitle="Could not load files"
            isEmpty={items.length === 0}
            empty={
              query ? (
                "No files match this search."
              ) : (
                <span className="flex flex-col items-center gap-2">
                  <FileIcon className="size-5" />
                  <span>No files yet. Upload one to share it with this organization.</span>
                </span>
              )
            }
          >
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
                      <div className="truncate font-medium" title={file.name}>
                        {file.name}
                      </div>
                      <div
                        className="truncate text-muted-foreground"
                        title={file.mimeType ?? "unknown type"}
                      >
                        {file.mimeType ?? "unknown type"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground tabular-nums">
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
                        {canDelete ? (
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
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>
      {confirmDialog}
    </>
  );
}
