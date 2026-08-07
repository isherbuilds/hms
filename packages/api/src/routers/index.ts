import type { RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { dashboardRouter } from "./dashboard";
import { filesRouter } from "./files";
import { membersRouter } from "./members";
import { todoRouter } from "./todo";

export const appRouter = {
  dashboard: dashboardRouter,
  todo: todoRouter,
  audit: auditRouter,
  files: filesRouter,
  members: membersRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
