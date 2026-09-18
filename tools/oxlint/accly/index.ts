import { eslintCompatPlugin } from "@oxlint/plugins";

import { noBigintInComponentsRule } from "./rules/no-bigint-in-components.ts";

/** Project-owned Oxlint rules. Kept out of `anti-slop/`, which is vendored upstream. */
const acclyPlugin = eslintCompatPlugin({
  meta: { name: "accly" },
  rules: {
    "no-bigint-in-components": noBigintInComponentsRule,
  },
});

export default acclyPlugin;
