import { Button } from "@hms/ui/components/button";
import { useFormContext, useWatch } from "react-hook-form";

import { FinancialSummary } from "@/components/opd-financial-summary";
import { ServiceLines } from "@/components/opd-intake-services";
import type { IntakeValues } from "@/components/opd-intake-form";
import type { QuoteState } from "@/components/opd-intake-quote";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { errorMessage } from "@/lib/orpc-error";

export function omitsConsultFee(values: Pick<IntakeValues, "omitConsultFee" | "services">) {
  return values.omitConsultFee || values.services.some((s) => s.category === "consultation");
}

export function ServicesFields({
  orgSlug,
  currency,
  quoteState,
}: {
  orgSlug: string;
  currency: string;
  quoteState: QuoteState;
}) {
  const form = useFormContext<IntakeValues>();
  const when = useWatch({ control: form.control, name: "when", exact: true });

  const services = useWatch({
    control: form.control,
    name: "services",
    exact: true,
  });

  const omitConsultFee = useWatch({
    control: form.control,
    name: "omitConsultFee",
    exact: true,
  });

  const consultation = quoteState.data.lines.find((line) => line.source === "consultation");

  const serviceGross = new Map(
    quoteState.data.lines
      .filter((line) => line.source === "service")
      .map((line) => [line.chargeId, line.gross]),
  );

  const chosen = new Set([
    ...services.map((service) => service.catalogItemId),
    ...(consultation ? [consultation.chargeId] : []),
  ]);

  const lines = [
    ...(when === "now" && consultation && !omitsConsultFee({ omitConsultFee, services })
      ? [
          {
            key: "consultation",
            description: consultation.description,
            category: consultation.category,
            qty: 1,
            unitPrice: consultation.unitPrice,
            customRate: false,
            taxRatePercent: consultation.taxRatePercent,
            gross: consultation.gross,
            editable: false,
          },
        ]
      : []),
    ...services.map((service) => ({
      key: service.catalogItemId,
      description: service.name,
      category: service.category,
      qty: service.qty,
      unitPrice: service.unitPrice,
      customRate: service.customRate,
      customUnitPrice: service.customUnitPrice,
      taxRatePercent: service.taxRatePercent,
      gross: when === "now" ? serviceGross.get(service.catalogItemId) : undefined,
      editable: true,
    })),
  ];

  const patchService = (catalogItemId: string, patch: Partial<ServiceLine>) =>
    form.setValue(
      "services",
      services.map((service) =>
        service.catalogItemId === catalogItemId ? { ...service, ...patch } : service,
      ),
      { shouldDirty: true },
    );

  const remove = (catalogItemId: string, editable: boolean) => {
    if (!editable) {
      form.setValue("omitConsultFee", true, { shouldDirty: true });

      return;
    }

    form.setValue(
      "services",
      services.filter((service) => service.catalogItemId !== catalogItemId),
      { shouldDirty: true },
    );
  };

  return (
    <div className="grid gap-3">
      <ServicePicker
        orgSlug={orgSlug}
        chosen={chosen}
        allowConsultation={when === "now"}
        onAdd={(line) => form.setValue("services", [...services, line], { shouldDirty: true })}
      />
      {when === "now" && !quoteState.ready && quoteState.error ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not calculate the bill</p>
          <p className="text-muted-foreground">
            {errorMessage(quoteState.error, "Could not reach the server")}
          </p>
        </div>
      ) : null}
      <ServiceLines lines={lines} currency={currency} onChange={patchService} onRemove={remove} />
      {when === "now" && omitConsultFee ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="justify-self-start"
          onClick={() => form.setValue("omitConsultFee", false, { shouldDirty: true })}
        >
          Restore consultation fee
        </Button>
      ) : null}
      {/* No bill while the quote is unreachable: the server never gave that total. */}
      {when === "now" && !quoteState.error ? (
        <div className="border-t border-border pt-3 lg:hidden">
          <FinancialSummary quote={quoteState.data} />
        </div>
      ) : null}
    </div>
  );
}
