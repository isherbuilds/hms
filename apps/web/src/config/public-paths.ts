import { PUBLIC_ROUTES } from "./site";

// Indexing needs filenames, not article bodies. The lazy glob keeps MDX out of
// the shared app bundle; changelog routes load the entries when visited.
const entries = import.meta.glob("../content/changelog/*.mdx");
export const PUBLIC_PATHS = [
  ...PUBLIC_ROUTES.map((route) => route.path),
  ...Object.keys(entries).map((path) =>
    path.replace("../content/changelog/", "/changelog/").replace(/\.mdx$/, ""),
  ),
];
