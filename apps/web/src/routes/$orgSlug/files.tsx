import { Button } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, Trash2, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  DataList,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const canDelete = useCan(orgSlug, { file: ["delete"] });
  const canUpload = useCan(orgSlug, { file: ["upload"] });

  const files = useInfiniteQuery(filesQuery(orgSlug, query));

  const upload = useMutation({
    mutationFn: (file: File) => uploadOrgFile(orgSlug, file),
    onSuccess: (_, file) => {
      toast.success(`Uploaded ${file.name}`);
    },
  });

  const download = async (key: string) => {
    try {
      await openOrgFile(orgSlug, key);
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that file"));
    }
  };

  const remove = useMutation({
    mutationFn: ({ key }: { key: string; name: string }) => orpc.file.delete.call({ orgSlug, key }),
    onSuccess: (_, { name }) => {
      toast.success(`Deleted ${name}`);
    },
  });

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
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    upload.mutate(file);
                  }

                  event.target.value = "";
                }}
              />
              <Button disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
                <UploadIcon data-icon="inline-start" />
                {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            </>
          ) : undefined
        }
      />

      <PageBody>
        <ListToolbar>
          <SearchInput label="Search files" placeholder="File name" onQueryChange={setQuery} />
        </ListToolbar>
        <Panel grow footer={<LoadMore query={files} shown={items.length} />}>
          <ListState
            query={files}
            errorTitle="Could not load files"
            isEmpty={items.length === 0}
            empty={query ? "No matching files" : "No files yet"}
          >
            <DataList
              columns={[
                {
                  head: "Name",
                  className: "max-w-0",
                  cell: (file) => (
                    <>
                      <div className="truncate font-medium" title={file.name}>
                        {file.name}
                      </div>
                      <div
                        className="truncate text-muted-foreground"
                        title={file.mimeType ?? "unknown type"}
                      >
                        {file.mimeType ?? "unknown type"}
                      </div>
                    </>
                  ),
                },
                {
                  head: "Size",
                  className: "text-right",
                  cell: (file) => (
                    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatFileSize(file.size)}
                    </span>
                  ),
                },
                {
                  head: "Added",
                  cell: (file) => (
                    <span className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(file.createdAt, timeZone)}
                    </span>
                  ),
                },
              ]}
              rows={items}
              rowKey={(file) => file.id}
              action={(file) => (
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
                          run: () => remove.mutate({ key: file.id, name: file.name }),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              )}
            />
          </ListState>
        </Panel>
      </PageBody>
      {confirmDialog}
    </>
  );
}
