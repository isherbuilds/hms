import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { Label } from "@hms/ui/components/label";
import { NativeSelect } from "@hms/ui/components/native-select";
import { Separator } from "@hms/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { appHead } from "@/config/site";
import { ChosenServices } from "@/components/chosen-services";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { formatBusinessDate } from "@/lib/business-date";
import { estimateStay } from "@/lib/ipd-estimate";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { IpdTabs } from "./route";

const facilityQuery = (orgSlug: string) => orpc.ipd.facility.queryOptions({ input: { orgSlug } });

export const Route = createFileRoute("/$orgSlug/ipd/estimate")({
  head: () => appHead("Estimate"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { ipd: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.query(facilityQuery(orgSlug)).catch(() => {});
  },
  component: EstimateRoute,
});

// The longest stay an estimate is made for; anything longer is a conversation, not a quote.
const MAX_DAYS = 365;

/**
 * A pre-admission estimate for reception: a bed type, the expected days and any Services.
 * Computed in the browser by `estimateStay`, printed from here, and stored nowhere.
 */
function EstimateRoute() {
  const { orgSlug } = Route.useParams();
  const { today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const registered = useMembership(orgSlug, (membership) => membership.gstRegistered);

  const orgName = useMembership(
    orgSlug,
    (membership) => membership.organizations.find((org) => org.slug === orgSlug)?.name ?? "",
  );

  const canSearchServices = useCan(orgSlug, { catalog: ["read"] });
  const canReadSettings = useCan(orgSlug, { settings: ["read"] });
  const facility = useQuery(facilityQuery(orgSlug));

  // The letterhead's address; the organization's name alone when settings are not readable.
  const settings = useQuery({
    ...orpc.settings.get.queryOptions({ input: { orgSlug } }),
    enabled: canReadSettings,
  });

  const [categoryId, setCategoryId] = useState("");
  const [daysText, setDaysText] = useState("1");
  const [preparedFor, setPreparedFor] = useState("");
  const [services, setServices] = useState<ServiceLine[]>([]);

  // Only a bed type with a rate in force can be taken, so only those are estimated.
  const priced = (facility.data?.categories ?? []).flatMap((category) =>
    category.currentTariff ? [{ ...category, tariff: category.currentTariff }] : [],
  );

  const category = priced.find((each) => each.id === categoryId);
  const days = Number(daysText);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

  const estimate =
    category && daysValid
      ? estimateStay({
          days,
          tariffLines: category.tariff.lines,
          services: services.map((line) => ({
            unitPrice: line.unitPrice,
            taxRatePercent: line.taxRatePercent,
            qty: line.qty,
          })),
          registered,
        })
      : null;

  const money = (paise: bigint) => formatMoney(paise, currency);

  return (
    <>
      <PageHeader title="IPD" />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody width="max-w-3xl">
        <ListState
          query={facility}
          errorTitle="Could not load bed types"
          isEmpty={priced.length === 0}
          empty={<p className="p-3 text-muted-foreground">No bed type has a daily rate yet.</p>}
        >
          <Panel label="Stay" padded minHeight="">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="estimate-bed-type">Bed type</Label>
                <NativeSelect
                  id="estimate-bed-type"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Choose a bed type</option>
                  {priced.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="estimate-days">Expected days</Label>
                <Input
                  id="estimate-days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DAYS}
                  step={1}
                  value={daysText}
                  aria-invalid={!daysValid || undefined}
                  className="tabular-nums"
                  onChange={(event) => setDaysText(event.target.value)}
                />
              </div>
            </div>
            {category ? (
              <ul className="flex flex-col">
                {category.tariff.lines.map((line) => (
                  <li key={line.catalogItemId} className="flex justify-between gap-3">
                    <span className="min-w-0 text-muted-foreground">{line.serviceName}</span>
                    <span className="tabular-nums">{money(line.dailyPrice)} a day</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {daysValid ? null : (
              <p role="alert" className="text-destructive">
                Enter whole days from 1 to {MAX_DAYS}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="estimate-for">For (optional)</Label>
              <Input
                id="estimate-for"
                value={preparedFor}
                maxLength={200}
                placeholder="Name to print on the estimate"
                onChange={(event) => setPreparedFor(event.target.value)}
              />
            </div>
          </Panel>

          {canSearchServices ? (
            <Panel label="Expected services" padded minHeight="">
              <ServicePicker
                orgSlug={orgSlug}
                chosen={new Set(services.map((line) => line.catalogItemId))}
                services="any"
                taxedBillable={registered}
                onAdd={(line) => setServices((current) => [...current, line])}
              />
              <ChosenServices
                lines={services}
                onChange={setServices}
                currency={currency}
                registered={registered}
              />
            </Panel>
          ) : null}

          <Panel label="Estimate" padded minHeight="">
            {estimate ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <dl className="grid w-full gap-1 sm:order-2 sm:max-w-64">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Bed charges</dt>
                    <dd className="tabular-nums">{money(estimate.bedCharges)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Services</dt>
                    <dd className="tabular-nums">{money(estimate.services)}</dd>
                  </div>
                  {estimate.tax === ZERO ? null : (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">GST</dt>
                      <dd className="tabular-nums">{money(estimate.tax)}</dd>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between gap-3 font-medium">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{money(estimate.total)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 font-medium">
                    <dt>Suggested deposit</dt>
                    <dd className="tabular-nums">{money(estimate.suggestedDeposit)}</dd>
                  </div>
                </dl>
                <Button className="self-start sm:order-1" onClick={() => window.print()}>
                  Print estimate
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Choose a bed type and the expected days to see the estimate.
              </p>
            )}
          </Panel>

          {estimate && category ? (
            <article
              data-ipd-estimate
              className="hidden bg-white text-xs leading-snug text-black print:block"
            >
              <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
                <div className="min-w-0">
                  <h1 className="text-base font-bold">{settings.data?.legalName ?? orgName}</h1>
                  {settings.data?.address ? (
                    <p className="mt-1 whitespace-pre-line">{settings.data.address}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold uppercase">Estimate — not a bill</p>
                  <p className="tabular-nums">{formatBusinessDate(today)}</p>
                </div>
              </header>
              <dl className="grid grid-cols-[32mm_1fr] gap-x-3 gap-y-1 border-b border-black py-3">
                {preparedFor.trim() ? (
                  <>
                    <dt className="font-semibold">For</dt>
                    <dd className="capitalize">{preparedFor.trim()}</dd>
                  </>
                ) : null}
                <dt className="font-semibold">Bed type</dt>
                <dd>{category.name}</dd>
                <dt className="font-semibold">Expected days</dt>
                <dd className="tabular-nums">{days}</dd>
              </dl>
              <table className="mt-3 w-full border-collapse">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-1 font-semibold">Item</th>
                    <th className="py-1 text-right font-semibold">Qty</th>
                    <th className="py-1 text-right font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {category.tariff.lines.map((line) => (
                    <tr key={line.catalogItemId} className="border-b border-neutral-300">
                      <td className="py-1">{line.serviceName}</td>
                      <td className="py-1 text-right tabular-nums">{days} days</td>
                      <td className="py-1 text-right tabular-nums">
                        {money(line.dailyPrice)} a day
                      </td>
                    </tr>
                  ))}
                  {services.map((line) => (
                    <tr key={line.catalogItemId} className="border-b border-neutral-300">
                      <td className="py-1">{line.name}</td>
                      <td className="py-1 text-right tabular-nums">{line.qty}</td>
                      <td className="py-1 text-right tabular-nums">{money(line.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 ml-auto grid w-64 gap-1">
                <div className="flex justify-between gap-3">
                  <dt>Bed charges</dt>
                  <dd className="tabular-nums">{money(estimate.bedCharges)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Services</dt>
                  <dd className="tabular-nums">{money(estimate.services)}</dd>
                </div>
                {estimate.tax === ZERO ? null : (
                  <div className="flex justify-between gap-3">
                    <dt>GST</dt>
                    <dd className="tabular-nums">{money(estimate.tax)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t border-black pt-1 font-bold">
                  <dt>Estimated total</dt>
                  <dd className="tabular-nums">{money(estimate.total)}</dd>
                </div>
                <div className="flex justify-between gap-3 font-bold">
                  <dt>Suggested deposit</dt>
                  <dd className="tabular-nums">{money(estimate.suggestedDeposit)}</dd>
                </div>
              </dl>
              <p className="mt-6">
                An estimate only. The final bill follows the actual stay, medicines and services.
              </p>
            </article>
          ) : null}
        </ListState>
      </PageBody>

      <style>{`@media print {
        @page { size: A4 portrait; margin: 15mm; }
        body * { visibility: hidden !important; }
        [data-ipd-estimate], [data-ipd-estimate] * { visibility: visible !important; }
        [data-ipd-estimate] { position: absolute; inset: 0 auto auto 0; width: 100%; }
      }`}</style>
    </>
  );
}
