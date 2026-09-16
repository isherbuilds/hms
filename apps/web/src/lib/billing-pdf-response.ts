import { createRequestContext } from "@hms/api/lib/context";
import { appRouter, type AppRouter } from "@hms/api/routers/index";
import { ORPCError, createRouterClient, type RouterClient } from "@orpc/server";

import { pdfContentDisposition } from "@/lib/content-disposition";

/** `produce` keeps the renderer import lazy (D021), out of the route chunk. */
export async function pdfResponse(
  request: Request,
  download: boolean,
  produce: (client: RouterClient<AppRouter>) => Promise<{ bytes: Uint8Array; fileName: string }>,
): Promise<Response> {
  const client = createRouterClient(appRouter, {
    context: () => createRequestContext(new Headers(request.headers)),
  });

  try {
    const { bytes, fileName } = await produce(client);

    // SAFETY: `slice()` owns a contiguous buffer with the exact PDF byte range.
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": pdfContentDisposition(fileName, download),
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      return new Response(error.message, { status: error.status });
    }

    console.error(error);

    return new Response("Could not render the document", { status: 500 });
  }
}
