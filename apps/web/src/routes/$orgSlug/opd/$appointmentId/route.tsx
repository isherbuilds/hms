import { authorize, type AppPermission } from "@hms/auth/access";
import { cn } from "@hms/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";

/**
 * An OPD Appointment has two views: what the clinician does and what
 * the cashier does. They stay separate screens — the billing surface is large
 * and its mistakes are expensive — but they share a URL root so a terminal can
 * move between them without going back through a list.
 */
export const OPD_TABS: readonly {
  to: "/$orgSlug/opd/$appointmentId" | "/$orgSlug/opd/$appointmentId/billing";
  label: string;
  permission: AppPermission;
}[] = [
  { to: "/$orgSlug/opd/$appointmentId", label: "Clinical", permission: { opd: ["read"] } },
  {
    to: "/$orgSlug/opd/$appointmentId/billing",
    label: "Billing",
    permission: { billing: ["read"] },
  },
];

export const Route = createFileRoute("/$orgSlug/opd/$appointmentId")({
  loader: async ({ context: { queryClient }, params: { orgSlug, appointmentId } }) => {
    // Both tabs already read this key, so the layout shares their cache entry
    // rather than adding a request. It is fetched here only to name the tab.
    const data = await loadRouteQuery(
      queryClient.ensureQueryData(orpc.opd.get.queryOptions({ input: { orgSlug, appointmentId } })),
    );
    // A booked appointment has no token or patient yet — name it by the caller.
    return {
      tokenNumber: data.appointment.tokenNumber,
      name: data.patient ? data.patient.name : data.appointment.callerName,
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? loaderData.tokenNumber != null
            ? `Token ${loaderData.tokenNumber} · ${loaderData.name ?? "OPD appointment"} · HMS`
            : `Booked · ${loaderData.name ?? "OPD appointment"} · HMS`
          : "OPD appointment · HMS",
      },
    ],
  }),
  component: OpdAppointmentLayout,
});

function OpdAppointmentLayout() {
  const { orgSlug, appointmentId } = Route.useParams();
  const membership = useSuspenseQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const visible = OPD_TABS.filter(({ permission }) => authorize(membership.data.roles, permission));

  return (
    <>
      <nav
        aria-label="OPD appointment sections"
        className="flex gap-1 overflow-x-auto border-b border-border px-4 print:hidden"
      >
        {visible.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            params={{ orgSlug, appointmentId }}
            // The clinical tab is the index route, so prefix matching would
            // keep it active while Billing is open.
            activeOptions={{ exact: to === "/$orgSlug/opd/$appointmentId" }}
            className={cn(
              "-mb-px shrink-0 border-b-2 border-transparent px-2 py-2 text-xs text-muted-foreground transition-colors",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "data-[status=active]:border-foreground data-[status=active]:font-medium data-[status=active]:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
