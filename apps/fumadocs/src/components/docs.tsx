import { navigate } from "astro:transitions/client";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "@fumadocs/base-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "@fumadocs/base-ui/layouts/docs/page";
import { RootProvider } from "@fumadocs/base-ui/provider/astro";
import type { ReactNode } from "react";

import SearchDialog from "./search";

export function Docs({
  tree,
  children,
  pathname,
  params,
  page,
}: {
  tree: Root;
  children: ReactNode;
  pathname: string;
  params: AstroProviderProps["params"];
  page?: DocsPageProps;
}) {
  return (
    <RootProvider
      pathname={pathname}
      params={params}
      navigate={navigate}
      theme={{ enabled: false }}
      search={{ SearchDialog }}
    >
      <DocsLayout
        tree={tree}
        themeSwitch={{
          enabled: false,
        }}
        nav={{
          title: "Fumadocs on Astro",
        }}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
