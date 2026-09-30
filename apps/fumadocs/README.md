# Staff guide

This Astro/Fumadocs application contains task instructions for HMS staff.
[Repository documentation](../../docs/README.md) owns architecture, development,
operations, and implementation status.

## Run and build

From the repository root:

```sh
bun run --cwd apps/fumadocs dev
bun run --cwd apps/fumadocs build
```

Development uses `https://docs.hms.localhost/docs` through Portless. See
[Development](../../docs/development.md#development-urls) for proxy setup and
bypass. The documentation app can run without the HMS database or API.

The production web build bundles this site's static output at `/docs` on the
main web domain. The web Dockerfile and Turbo build graph build the guide first.
No separate documentation container or domain is needed. To test the same path
locally, run `bun run build --filter=web` and start the web build.

## Edit a guide

- Edit the MDX pages in [content/docs](./content/docs/). Keep frontmatter titles
  and descriptions clear enough for navigation and search.
- Add or reorder pages in [meta.json](./content/docs/meta.json).
- Store demo screenshots as lossless WebP in [public/images/guides](./public/images/guides/).
  Keep their original dimensions and check that decoded pixels match the source.
  Use `/docs/images/guides/name.webp` in MDX and describe the visible task in alt text.
- Prefix internal page links with `/docs`, including links to headings.
- Use the current screen labels. Distinguish opening a review from the button
  that saves a record. Explain the result and how to check an uncertain save.
- Use demo records only. Check text against the owning forms and procedures;
  screenshots can lag behind behavior.

After editing, build the site. Check internal page links, heading links, and
images. Open the changed guides at desktop and mobile widths to check that
steps, pictures, and navigation remain readable.
