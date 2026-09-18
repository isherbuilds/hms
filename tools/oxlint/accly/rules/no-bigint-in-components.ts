import { defineRule } from "@oxlint/plugins";

/**
 * Ban bigint literals in files the React Compiler compiles.
 *
 * oxc's React Compiler pass rewrites every bigint literal inside a component it
 * compiles to `undefined`, and reports no error. `paise === 0n` silently becomes
 * `paise === undefined`, so a money comparison returns the wrong answer with a green
 * build and a green type check. Amounts belong in the money module, which holds no
 * components and is therefore never compiled.
 */
export const noBigintInComponentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bigint literals in .tsx; the React Compiler rewrites them to `undefined`.",
    },
    messages: {
      bigintLiteral:
        "No bigint literals in a .tsx file: the React Compiler rewrites them to `undefined` inside a compiled component. Move the amount into the money module, which holds no components and is never compiled, and call a helper from there.",
    },
  },
  createOnce(context) {
    return {
      // ESTree models `0n` as a Literal carrying a `bigint` string, not its own node type.
      Literal(node) {
        if (typeof node.bigint === "string") {
          context.report({ node, messageId: "bigintLiteral" });
        }
      },
    };
  },
});
