import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { createContext, useContext } from "react";

type OpdRecord = Awaited<ReturnType<RouterClient<AppRouter>["opd"]["get"]>>;

// Read once by the layout and shared with both tab bodies: a per-tab observer would
// only mean a second 10s poll of the same record.
export const OpdRecordContext = createContext<{
  record: OpdRecord;
  /** A non-authorization background read that failed while the record stayed last-good. */
  refreshError: Error | null;
} | null>(null);

export function useOpdRecord() {
  const value = useContext(OpdRecordContext);
  if (!value) {
    throw new Error("useOpdRecord is only available under the outpatient appointment layout");
  }

  return value;
}
