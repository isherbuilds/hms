import type { RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { catalogRouter } from "./catalog";
import { dashboardRouter } from "./dashboard";
import { filesRouter } from "./files";
import { membersRouter } from "./members";
import { patientRouter } from "./patient";
import { settingsRouter } from "./settings";
import { staffRouter } from "./staff";
import { visitRouter } from "./visit";

export const appRouter = {
  dashboard: dashboardRouter,
  settings: settingsRouter,
  audit: auditRouter,
  billing: billingRouter,
  files: filesRouter,
  members: membersRouter,
  patient: patientRouter,
  visit: visitRouter,
  catalog: catalogRouter,
  staff: staffRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
