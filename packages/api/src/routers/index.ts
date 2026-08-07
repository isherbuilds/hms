import type { RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { dashboardRouter } from "./dashboard";
import { filesRouter } from "./files";
import { membersRouter } from "./members";
import { patientRouter } from "./patient";
import { settingsRouter } from "./settings";

export const appRouter = {
  dashboard: dashboardRouter,
  settings: settingsRouter,
  audit: auditRouter,
  files: filesRouter,
  members: membersRouter,
  patient: patientRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
