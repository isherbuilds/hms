import type { RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { catalogRouter } from "./catalog";
import { dashboardRouter } from "./dashboard";
import { fileRouter } from "./file";
import { memberRouter } from "./member";
import { patientRouter } from "./patient";
import { payerRouter } from "./payer";
import { reportRouter } from "./report";
import { settingsRouter } from "./settings";
import { staffRouter } from "./staff";
import { opdRouter } from "./opd";
import { treatmentRouter } from "./treatment";

export const appRouter = {
  audit: auditRouter,
  billing: billingRouter,
  catalog: catalogRouter,
  dashboard: dashboardRouter,
  file: fileRouter,
  member: memberRouter,
  patient: patientRouter,
  payer: payerRouter,
  report: reportRouter,
  settings: settingsRouter,
  staff: staffRouter,
  opd: opdRouter,
  treatment: treatmentRouter,
};

export type AppRouter = typeof appRouter;

export type AppRouterClient = RouterClient<typeof appRouter>;
