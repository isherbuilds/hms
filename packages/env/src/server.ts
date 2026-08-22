import "./load.ts";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    CORS_ORIGIN: z.url(),
    FOUNDING_EMAIL: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SEAWEEDFS_ENDPOINT: z.url().optional(),
    SEAWEEDFS_ACCESS_KEY_ID: z.string().optional(),
    SEAWEEDFS_SECRET_ACCESS_KEY: z.string().optional(),
    SEAWEEDFS_BUCKET: z.string().optional(),
    SEAWEEDFS_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional(),
  },
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((values, context) => {
      if (
        values.NODE_ENV === "production" &&
        new URL(values.BETTER_AUTH_URL).hostname !== new URL(values.CORS_ORIGIN).hostname &&
        !values.BETTER_AUTH_COOKIE_DOMAIN
      ) {
        context.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_COOKIE_DOMAIN"],
          message: "Required when the web and API use different hosts",
        });
      }
    }),
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
