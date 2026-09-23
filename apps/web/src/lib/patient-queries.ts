import { orpc } from "@/lib/orpc";

export const patientVisitsQuery = (orgSlug: string, patientId: string) =>
  orpc.patient.visits.infiniteOptions({
    input: (cursor: { businessDate: string; id: string } | undefined) => ({
      orgSlug,
      patientId,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
