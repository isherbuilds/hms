declare module "*.mdx" {
  import type { ComponentType } from "react";
  import type { ChangelogMeta } from "./changelog";

  export const meta: ChangelogMeta;
  const Content: ComponentType;
  export default Content;
}
