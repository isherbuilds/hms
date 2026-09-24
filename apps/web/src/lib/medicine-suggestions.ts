type TruemedsProduct = {
  skuName: string;
  strength: string | null;
  packSize: string;
  unit: string;
  packForm: string | null;
  drugType: string | null;
  manufacturerName: string | null;
  isAd: boolean;
};

type TruemedsSearchResponse = {
  responseData: { productList: { product: TruemedsProduct }[] | null };
};

type MedbuzzProduct = {
  productName: string;
  genericName: string | null;
  manufacturedBy: string | null;
  packing: string | null;
};

type MedbuzzSearchResponse = {
  success: boolean;
  extras: {
    Data: { Type: number; Product_Data?: MedbuzzProduct }[];
  };
};

export type MedicineSuggestion = {
  name: string;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  unitsPerPack: number | null;
  packSizeLabel: string | null;
};

const MEASURE = /^(ml|mg|g|gm|kg|l|mcg|µg|iu)$/i;

export function mapTruemedsProduct(product: TruemedsProduct): MedicineSuggestion {
  return {
    name: product.skuName,
    strength: product.strength || null,
    form: product.drugType?.toLowerCase() ?? null,
    manufacturer: product.manufacturerName || null,
    unitsPerPack:
      product.unit === "Units" && /^[1-9]\d*$/.test(product.packSize)
        ? Number(product.packSize)
        : null,
    packSizeLabel: product.packForm || null,
  };
}

export function mapMedbuzzProduct(data: MedbuzzProduct): MedicineSuggestion {
  // Medbuzz has no form field; the product name ends with it ("… EYE DROPS", "… DRY SYRUP").
  // "Strip of 10 Tablets" counts; "Bottle of 5ml" is a measure, not a count.
  const pack = data.packing?.match(/of\s+(\d+)\s*([a-z]+)/i);

  return {
    name: data.productName,
    strength: data.genericName?.match(/\d+(?:\.\d+)?[a-zµ%]+/gi)?.join(" / ") ?? null,
    form: data.productName.split(/\s+/).at(-1)?.toLowerCase() ?? null,
    manufacturer: data.manufacturedBy || null,
    unitsPerPack: pack && !MEASURE.test(pack[2]!) ? Number(pack[1]) : null,
    packSizeLabel: data.packing || null,
  };
}

async function searchMedbuzz(q: string, signal: AbortSignal): Promise<MedicineSuggestion[]> {
  const response = await fetch(
    "https://searchapi.medbuzz.in/admin/Filter_All_Medbuzz_Search_Keys",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ApiKey: "",
        USERID: "",
        SessionID: "",
        warehouseId: 1,
        Skip: 0,
        Limit: 10,
        Whether_Search_Filter: true,
        Search: q,
      }),
      signal,
    },
  );

  if (!response.ok) throw new Error("Medicine suggestions unavailable");

  // SAFETY: unofficial endpoint; only the typed fields are read, and a shape change fails into manual entry (D046).
  const data = (await response.json()) as MedbuzzSearchResponse;

  if (!data.success) throw new Error("Medicine suggestions unavailable");

  // Type 1 rows are stocked products; the rest are bare index names.
  return data.extras.Data.flatMap((row) =>
    row.Type === 1 && row.Product_Data ? mapMedbuzzProduct(row.Product_Data) : [],
  );
}

async function searchTruemeds(q: string, signal: AbortSignal): Promise<MedicineSuggestion[]> {
  const response = await fetch(
    `https://nal.tmmumbai.in/CustomerService/getSearchSuggestion?warehouseId=3&elasticSearchType=SKU_BRAND_SEARCH&searchString=${encodeURIComponent(q)}`,
    { signal },
  );

  if (!response.ok) throw new Error("Medicine suggestions unavailable");

  // SAFETY: unofficial endpoint; only the typed fields are read, and a shape change fails into manual entry (D046).
  const data = (await response.json()) as TruemedsSearchResponse;

  return (data.responseData.productList ?? []).flatMap(({ product }) =>
    product.isAd ? [] : mapTruemedsProduct(product),
  );
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Names starting with the typed text first (Medbuzz answers a brand with its substitutes), Medbuzz before Truemeds, unique by name, six at most. */
export function mergeSuggestions(
  q: string,
  medbuzz: MedicineSuggestion[],
  truemeds: MedicineSuggestion[],
): MedicineSuggestion[] {
  const typed = key(q);
  const seen = new Set<string>();

  return [...medbuzz, ...truemeds]
    .sort((a, b) => Number(key(b.name).startsWith(typed)) - Number(key(a.name).startsWith(typed)))
    .filter((suggestion) => !seen.has(key(suggestion.name)) && seen.add(key(suggestion.name)))
    .slice(0, 6);
}

/** Public suggestions only: never send user or organization identity (D046). */
export async function searchMedicines(
  q: string,
  signal: AbortSignal,
): Promise<MedicineSuggestion[]> {
  // One slow source must not hold the other's answer.
  signal = AbortSignal.any([signal, AbortSignal.timeout(4000)]);

  const [medbuzz, truemeds] = await Promise.allSettled([
    searchMedbuzz(q, signal),
    searchTruemeds(q, signal),
  ]);

  if (medbuzz.status === "rejected" && truemeds.status === "rejected") {
    throw new Error("Medicine suggestions unavailable");
  }

  return mergeSuggestions(
    q,
    medbuzz.status === "fulfilled" ? medbuzz.value : [],
    truemeds.status === "fulfilled" ? truemeds.value : [],
  );
}
