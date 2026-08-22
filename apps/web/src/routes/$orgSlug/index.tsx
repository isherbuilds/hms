import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$orgSlug/")({
  beforeLoad: ({ params: { orgSlug } }) => {
    throw redirect({ to: "/$orgSlug/dashboard", params: { orgSlug } });
  },
});
