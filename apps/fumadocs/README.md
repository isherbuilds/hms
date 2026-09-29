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

Development uses `https://docs.hms.localhost` through Portless. See
[Development](../../docs/development.md#development-urls) for proxy setup and
bypass. The documentation app can run without the HMS database or API.

## Edit a guide

- Edit the MDX pages in [content/docs](./content/docs/). Keep frontmatter titles
  and descriptions clear enough for navigation and search.
- Add or reorder pages in [meta.json](./content/docs/meta.json).
- Store demo screenshots in [public/images/guides](./public/images/guides/).
  Use `/images/guides/name.png` in MDX and describe the visible task in alt text.
- Use the current screen labels. Distinguish opening a review from the button
  that saves a record. Explain the result and how to check an uncertain save.
- Use demo records only. Check text against the owning forms and procedures;
  screenshots can lag behind behavior.

After editing, build the site. Check internal page links, heading links, and
images. Open the changed guides at desktop and mobile widths to check that
steps, pictures, and navigation remain readable.
