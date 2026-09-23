import { z } from "zod";

const suggestion = z.object({
  type: z.string(),
  id: z.number(),
  label: z.string(),
  strength: z.string().nullable(),
  pack_form: z.string().nullable(),
  pack_size_label: z.string().nullable(),
  units_in_pack: z.number().int().nullable(),
  marketer_name: z.string().nullable(),
  manufacturer_name: z.string().nullable(),
  product_type: z.string(),
  // Sponsored slots carry an object here; organic results carry null.
  ad: z.unknown().nullable().optional(),
});

const responseBody = z.object({ results: z.array(z.unknown()) });

/** Public suggestions only: never send a user's or organization's identity to 1mg. */
export async function searchOneMg(q: string) {
  const response = await fetch(
    `https://www.1mg.com/api/v1/search/autocomplete?name=${encodeURIComponent(q)}&pageSize=6&types=sku,composition`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(3000),
    },
  );

  if (!response.ok) throw new Error(`1mg autocomplete returned ${response.status}`);

  const payload = responseBody.parse(await response.json());

  // 1mg treats pageSize as a hint (it mixes sku and composition hits), so cap here.
  return payload.results
    .flatMap((item) => {
      const parsed = suggestion.safeParse(item);

      if (!parsed.success) return [];

      const { type, product_type: productType, ad } = parsed.data;

      // Ads and devices/foods are not product masters for a pharmacy shelf.
      if (!["drug", "otc"].includes(type) || productType === "non_medicine" || ad) return [];

      const result = parsed.data;
      const lastWord = result.pack_size_label?.match(/([a-zA-Z]+)$/)?.[1];
      const form = lastWord ? lastWord.replace(/s$/i, "").toLowerCase() : null;

      return [
        {
          id: String(result.id),
          name: result.label,
          strength: result.strength,
          form,
          manufacturer: result.marketer_name ?? result.manufacturer_name,
          unitsPerPack: result.units_in_pack,
          packSizeLabel: result.pack_size_label,
        },
      ];
    })
    .slice(0, 6);
}
