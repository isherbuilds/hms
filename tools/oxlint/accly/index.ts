import { eslintCompatPlugin } from "@oxlint/plugins";

import { noBigintInComponentsRule } from "./rules/no-bigint-in-components.ts";
import { noLocalPageSizeRule } from "./rules/no-local-page-size.ts";
import { noUseEffectRule } from "./rules/no-use-effect.ts";

/** Project-owned Oxlint rules. Kept out of `anti-slop/`, which is vendored upstream. */
const acclyPlugin = eslintCompatPlugin({
  meta: { name: "accly" },
  rules: {
    "no-bigint-in-components": noBigintInComponentsRule,
    "no-local-page-size": noLocalPageSizeRule,
    "no-use-effect": noUseEffectRule,
  },
});

export default acclyPlugin;
