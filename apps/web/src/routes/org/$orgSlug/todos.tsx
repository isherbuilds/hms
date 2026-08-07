import { Button } from "@better-stack/ui/components/button";
import { Checkbox } from "@better-stack/ui/components/checkbox";
import { Empty, EmptyHeader } from "@better-stack/ui/components/empty";
import { Input } from "@better-stack/ui/components/input";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ListChecksIcon, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { orpc } from "@/lib/orpc";

const todosQuery = (orgSlug: string) =>
  orpc.todo.getAll.infiniteOptions({
    input: (cursor: { createdAt: Date; id: number } | undefined) => ({
      orgSlug,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/org/$orgSlug/todos")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void queryClient.prefetchInfiniteQuery(todosQuery(orgSlug));
  },
  component: TodosRoute,
});

function TodosRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const [newTodoText, setNewTodoText] = useState("");

  const todos = useInfiniteQuery(todosQuery(orgSlug));
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.todo.getAll.key({ input: { orgSlug } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.summary.key({ input: { orgSlug } }),
      }),
    ]);
  const onError = (error: Error) => toast.error(error.message);

  const create = useMutation(
    orpc.todo.create.mutationOptions({
      onSuccess: () => {
        refresh();
        setNewTodoText("");
      },
      onError,
    }),
  );
  const toggle = useMutation(orpc.todo.toggle.mutationOptions({ onSuccess: refresh, onError }));
  const remove = useMutation(orpc.todo.delete.mutationOptions({ onSuccess: refresh, onError }));

  const addTodo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = newTodoText.trim();
    if (text) {
      create.mutate({ orgSlug, text });
    }
  };

  const items = todos.data?.pages.flatMap((page) => page.items) ?? [];
  const done = items.filter((todo) => todo.completed).length;

  return (
    <>
      <PageHeader
        title="Todos"
        description={todos.isPending ? "Loading…" : `${done} complete · ${items.length} loaded`}
      />

      <div className="flex flex-col gap-4 p-4">
        <form onSubmit={addTodo} className="flex items-center gap-2">
          <Input
            value={newTodoText}
            onChange={(event) => setNewTodoText(event.target.value)}
            placeholder="Add a task"
            aria-label="New task"
            disabled={create.isPending}
          />
          <Button type="submit" disabled={create.isPending || !newTodoText.trim()}>
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </form>

        {todos.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        ) : todos.isError ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <p className="text-sm font-medium">Could not load todos</p>
              <p className="text-xs text-muted-foreground">{todos.error.message}</p>
            </EmptyHeader>
            <Button variant="outline" onClick={() => todos.refetch()}>
              Try again
            </Button>
          </Empty>
        ) : items.length === 0 ? (
          <Empty className="ring-1 ring-border">
            <EmptyHeader>
              <ListChecksIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing to do yet</p>
              <p className="text-xs text-muted-foreground">
                Add your first task using the field above.
              </p>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col ring-1 ring-border">
              {items.map((todo) => (
                <li
                  key={todo.id}
                  className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
                >
                  <Checkbox
                    id={`todo-${todo.id}`}
                    checked={todo.completed}
                    onCheckedChange={() =>
                      toggle.mutate({
                        orgSlug,
                        id: todo.id,
                        completed: !todo.completed,
                      })
                    }
                  />
                  <label
                    htmlFor={`todo-${todo.id}`}
                    className={`min-w-0 flex-1 truncate text-xs ${
                      todo.completed ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {todo.text}
                  </label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove.mutate({ orgSlug, id: todo.id })}
                    aria-label={`Delete "${todo.text}"`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>

            {todos.hasNextPage && (
              <Button
                variant="outline"
                className="self-start"
                disabled={todos.isFetchingNextPage}
                onClick={() => todos.fetchNextPage()}
              >
                {todos.isFetchingNextPage ? "Loading…" : "Load older tasks"}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
