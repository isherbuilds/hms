import { defineRule } from "@oxlint/plugins";

/**
 * One page size for every cursor list.
 *
 * Lists drifted to 20, 25, 50 and 100 rows because each new procedure wrote its own
 * `limit: z.number()…default(n)` and each client query passed its own `limit: n`.
 * The size lives only in `pageLimit` (packages/api/src/lib/schemas.ts): a cursor
 * procedure takes `limit: pageLimit`, and a client query omits `limit`. Forwarding
 * an already-parsed limit (`limit: input.limit`) stays allowed.
 */
export const noLocalPageSizeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a local page size next to a cursor; use `pageLimit`.",
    },
    messages: {
      localPageSize:
        "Page size is owned by `pageLimit` in packages/api/src/lib/schemas.ts. A cursor procedure takes `limit: pageLimit`; a client list query omits `limit` so the server default applies.",
    },
  },
  createOnce(context) {
    return {
      ObjectExpression(node) {
        let hasCursor = false;
        let limitValue = null;

        for (const property of node.properties) {
          if (property.type !== "Property" || property.key.type !== "Identifier") continue;
          if (property.key.name === "cursor") hasCursor = true;
          if (property.key.name === "limit") limitValue = property.value;
        }

        if (
          hasCursor &&
          limitValue &&
          ((limitValue.type === "Literal" && typeof limitValue.value === "number") ||
            limitValue.type === "CallExpression")
        ) {
          context.report({ node: limitValue, messageId: "localPageSize" });
        }
      },
    };
  },
});
