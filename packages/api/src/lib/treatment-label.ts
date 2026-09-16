import { treatmentPlanItems } from "@hms/db/schema/treatment-plan-items";
import { sql } from "drizzle-orm";

/**
 * A plan's display label, derived from its items in the order they were quoted:
 * "Root canal treatment + Crown", "Physiotherapy session ×10". Correlates to an
 * unaliased `treatment_plans`; the plan side is spelled out for the same reason as
 * `advanceRemaining`.
 */
export function planLabel(orgId: string) {
  return sql<string>`(select string_agg(
      ${treatmentPlanItems.description}
        || case when ${treatmentPlanItems.qtyPlanned} > 1
             then ' ×' || ${treatmentPlanItems.qtyPlanned} else '' end,
      ' + ' order by ${treatmentPlanItems.createdAt}, ${treatmentPlanItems.id})
    from ${treatmentPlanItems}
    where ${treatmentPlanItems.orgId} = ${orgId}
      and ${treatmentPlanItems.treatmentPlanId} = "treatment_plans"."id")`;
}
