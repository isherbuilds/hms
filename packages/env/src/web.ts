import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// SAFETY: Vite supplies import.meta.env; createEnv below validates each public setting.
const runtimeEnv = (
  import.meta as ImportMeta & {
    readonly env: Record<string, string | boolean | undefined>;
  }
).env;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    // A bare origin only: `z.url()` accepts `https://host/path`, which would
    // silently double every canonical and sitemap path built from it.
    VITE_WEB_URL: z
      .url()
      .transform((value) => value.replace(/\/$/, ""))
      .refine((value) => new URL(value).origin === value, {
        message: "VITE_WEB_URL must be a bare origin such as https://hms.example",
      }),
    // Public contact channels shown on /contact and in the footer. Digits only,
    // country code first, no `+`: that is the form `wa.me/<number>` accepts.
    VITE_WHATSAPP_NUMBER: z.string().regex(/^[1-9]\d{7,14}$/, "E.164 digits without +"),
    VITE_CONTACT_EMAIL: z.email(),
  },
  runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
