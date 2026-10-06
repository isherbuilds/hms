import { defineRule } from "@oxlint/plugins";

/**
 * An Effect only syncs React with an external system.
 *
 * Agents reached for `useEffect` where none was needed: a `<details>` section that
 * opened itself on form errors, and a route-level effect that moved focus on every
 * navigation. Both were removed in review. Each remaining Effect in `apps/web` syncs a
 * DOM API, timer, observer or subscription, and says so on its disable comment.
 */
export const noUseEffectRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow Effects unless they sync with an external system.",
    },
    messages: {
      effect:
        "No Effect for app logic: derive values during render, act in the event handler, use native HTML (`<details>`, form validation) or TanStack Router/Query. Only an Effect that syncs a DOM API, timer, observer or subscription stays, with `// oxlint-disable-next-line accly/no-use-effect -- <the external system>`.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : null;

        if (name === "useEffect" || name === "useLayoutEffect") {
          context.report({ node, messageId: "effect" });
        }
      },
    };
  },
});
