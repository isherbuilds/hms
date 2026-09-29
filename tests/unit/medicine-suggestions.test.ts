import { expect, test } from "bun:test";

import {
  mapMedbuzzProduct,
  mapTruemedsProduct,
  mergeSuggestions,
} from "../../apps/web/src/lib/medicine-suggestions";

const empty = { strength: "", form: "", manufacturer: "", pack: "" };

const first = {
  strength: "500 mg",
  form: "tablet",
  manufacturer: "Maker A",
  packSizeLabel: "Strip of 10 Units",
};

const second = {
  strength: "250 mg",
  form: "capsule",
  manufacturer: "Maker B",
  packSizeLabel: "Strip of 20 Units",
};

// The component imports the web client, whose environment is validated during module loading.
async function mergeSuggestion() {
  const previousSkip = process.env.SKIP_ENV_VALIDATION;
  process.env.SKIP_ENV_VALIDATION = "true";

  try {
    return (await import("../../apps/web/src/components/medicine-name-field"))
      .mergeMedicineSuggestion;
  } finally {
    if (previousSkip === undefined) delete process.env.SKIP_ENV_VALIDATION;
    else process.env.SKIP_ENV_VALIDATION = previousSkip;
  }
}

test("a second medicine pick replaces attributes owned by the first pick", async () => {
  const merge = await mergeSuggestion();
  const pickedA = merge(empty, {}, first);
  const pickedB = merge({ ...empty, ...pickedA }, pickedA, second);

  expect(pickedB).toEqual({
    strength: "250 mg",
    form: "capsule",
    manufacturer: "Maker B",
    pack: "20 units",
  });
});

test("a second pick preserves operator edits, including pack", async () => {
  const merge = await mergeSuggestion();
  const pickedA = merge(empty, {}, first);
  const current = { ...empty, ...pickedA, strength: "custom strength", pack: "custom pack" };

  expect(merge(current, pickedA, second)).toEqual({
    form: "capsule",
    manufacturer: "Maker B",
  });
});

test("a measured bottle fills pack and a missing label clears a previous pick", async () => {
  const merge = await mergeSuggestion();

  const suggestion = mapTruemedsProduct({
    skuName: "Omee Mps Mint Flavour Liquid 170Ml",
    strength: null,
    packSize: "170",
    unit: "ML",
    packForm: "Bottle of 170 ml",
    drugType: "LIQUID",
    manufacturerName: null,
    isAd: false,
  });

  expect(merge(empty, {}, suggestion).pack).toBe("170 ml");

  const pickedA = merge(empty, {}, first);
  expect(merge({ ...empty, ...pickedA }, pickedA, { ...second, packSizeLabel: null }).pack).toBe(
    "",
  );
});

test("Medbuzz maps strength, trailing form and printed pack labels without a form list", () => {
  expect(
    mapMedbuzzProduct({
      productName: "ZALMOX EYE DROPS",
      genericName: "Moxifloxacin Hydrochloride 0.5%",
      manufacturedBy: "LXIR MEDILABS PVT LTD",
      packing: "Bottle of 5ml",
    }),
  ).toEqual({
    name: "ZALMOX EYE DROPS",
    strength: "0.5%",
    form: "drops",
    manufacturer: "LXIR MEDILABS PVT LTD",
    packSizeLabel: "Bottle of 5ml",
  });

  const inhaler = mapMedbuzzProduct({
    productName: "EXAMPLE 200 INHALER",
    genericName: "Budesonide 200mcg + Formoterol 6mcg",
    manufacturedBy: null,
    packing: "Box of 2 Inhalers",
  });

  expect(inhaler).toMatchObject({
    strength: "200mcg / 6mcg",
    form: "inhaler",
    packSizeLabel: "Box of 2 Inhalers",
  });

  expect(
    mapMedbuzzProduct({
      productName: "EXAMPLE POWDER",
      genericName: null,
      manufacturedBy: null,
      packing: "Bottle of 100 gms",
    }).packSizeLabel,
  ).toBe("Bottle of 100 gms");
});

test("Truemeds preserves strip and measured bottle labels", () => {
  const strip = {
    skuName: "Example Tablet",
    strength: "100 MG",
    packSize: "10",
    unit: "Units",
    packForm: "Strip of 10 Units",
    drugType: "TABLET",
    manufacturerName: "Factory",
    isAd: false,
  };

  expect(mapTruemedsProduct(strip)).toEqual({
    name: "Example Tablet",
    strength: "100 MG",
    form: "tablet",
    manufacturer: "Factory",
    packSizeLabel: "Strip of 10 Units",
  });

  expect(
    mapTruemedsProduct({ ...strip, packSize: "5", unit: "ML", packForm: "Bottle of 5 ML" })
      .packSizeLabel,
  ).toBe("Bottle of 5 ML");
});

test("merge ranks the typed brand first, keeps source order, and de-duplicates by name", () => {
  const suggestion = (name: string) => ({
    ...second,
    name,
    packSizeLabel: null,
  });

  expect(
    mergeSuggestions(
      "zalmox",
      [suggestion("MOXITIK EYE DROPS"), suggestion("ZALMOX-D EYE DROPS")],
      [suggestion("Zalmox D Eye Drops"), suggestion("Zalmox Eye Drops")],
    ).map((item) => item.name),
  ).toEqual(["ZALMOX-D EYE DROPS", "Zalmox Eye Drops", "MOXITIK EYE DROPS"]);
});
