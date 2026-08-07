import { db } from "@better-stack/db";
import { todo } from "@better-stack/db/schema/todo";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import z from "zod";

import { orgInput, publicProcedure, requirePermission } from "../lib/procedures/factory";

export const todoRouter = {
  getAll: publicProcedure
    .input(
      orgInput.extend({
        cursor: z.object({ createdAt: z.coerce.date(), id: z.number().int() }).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .use(requirePermission({ todo: ["read"] }))
    .handler(async ({ context, input }) => {
      const orgFilter = eq(todo.orgId, context.scope.orgId);
      const items = await db
        .select()
        .from(todo)
        .where(
          input.cursor
            ? and(
                orgFilter,
                or(
                  lt(todo.createdAt, input.cursor.createdAt),
                  and(eq(todo.createdAt, input.cursor.createdAt), lt(todo.id, input.cursor.id)),
                ),
              )
            : orgFilter,
        )
        .orderBy(desc(todo.createdAt), desc(todo.id))
        .limit(input.limit);

      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          items.length === input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
      };
    }),

  create: publicProcedure
    .input(orgInput.extend({ text: z.string().min(1) }))
    .use(requirePermission({ todo: ["create"] }))
    .handler(async ({ context, input }) => {
      const { scope } = context;
      const [row] = await db
        .insert(todo)
        .values({ text: input.text, userId: scope.userId, orgId: scope.orgId })
        .returning();

      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create todo",
        });
      }
      return row;
    }),

  toggle: publicProcedure
    .input(orgInput.extend({ id: z.number(), completed: z.boolean() }))
    .use(requirePermission({ todo: ["update"] }))
    .handler(async ({ context, input }) => {
      // Scoped UPDATE ... RETURNING: no window between the authorization
      // check and the write.
      const [row] = await db
        .update(todo)
        .set({ completed: input.completed })
        .where(and(eq(todo.id, input.id), eq(todo.orgId, context.scope.orgId)))
        .returning();

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Todo not found" });
      }
      return row;
    }),

  delete: publicProcedure
    .input(orgInput.extend({ id: z.number() }))
    .use(requirePermission({ todo: ["delete"] }))
    .handler(async ({ context, input }) => {
      const [row] = await db
        .delete(todo)
        .where(and(eq(todo.id, input.id), eq(todo.orgId, context.scope.orgId)))
        .returning({ id: todo.id });

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Todo not found" });
      }
      return { success: true as const };
    }),
};
