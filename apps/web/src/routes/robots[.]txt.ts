import { env } from "@hms/env/web";
import { createFileRoute } from "@tanstack/react-router";

import { renderRobots } from "@/lib/public-crawl";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(renderRobots(env.VITE_WEB_URL), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
