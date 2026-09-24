import { expect, test } from "bun:test";

import {
  mapMedbuzzProduct,
  mapTruemedsProduct,
  mergeSuggestions,
} from "../../apps/web/src/lib/medicine-suggestions";

const empty = { strength: "", form: "", manufacturer: "", unitsPerPack: "1" };

const first = { strength: "500 mg", form: "tablet", manufacturer: "Maker A", unitsPerPack: 10 };

const second = { strength: "250 mg", form: "capsule", manufacturer: "Maker B", unitsPerPack: 20 };

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

test("a second medicine pick replaces the first pick's attributes and pack conversion", async () => {
  const merge = await mergeSuggestion();
  const pickedA = merge(empty, {}, first, false);
  const pickedB = merge({ ...empty, ...pickedA }, pickedA, second, false);

  expect(pickedB).toEqual({
    strength: "250 mg",
    form: "capsule",
    manufacturer: "Maker B",
    unitsPerPack: "20",
  });
});

test("a second pick preserves operator edits and cannot reconfigure an existing product pack", async () => {
  const merge = await mergeSuggestion();
  const pickedA = merge(empty, {}, first, false);
  const current = { ...empty, ...pickedA, strength: "custom strength", unitsPerPack: "24" };
  expect(merge(current, pickedA, second, false)).toEqual({
    form: "capsule",
    manufacturer: "Maker B",
  });
  expect(merge({ ...empty, ...pickedA }, pickedA, second, true)).toEqual({
    strength: "250 mg",
    form: "capsule",
    manufacturer: "Maker B",
  });
});

test("a second pick preserves an edited pack and ignores missing pack sizes", async () => {
  const merge = await mergeSuggestion();
  const pickedA = merge(empty, {}, first, false);
  const current = { ...empty, ...pickedA };

  expect(merge(current, pickedA, second, false, true).unitsPerPack).toBeUndefined();
  expect(
    merge(current, pickedA, { ...second, unitsPerPack: null }, false).unitsPerPack,
  ).toBeUndefined();
});

test("Medbuzz maps strength, trailing form and counted packs without a form list", () => {
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
    unitsPerPack: null,
    packSizeLabel: "Bottle of 5ml",
  });

  const inhaler = mapMedbuzzProduct({
    productName: "EXAMPLE 200 INHALER",
    genericName: "Budesonide 200mcg + Formoterol 6mcg",
    manufacturedBy: null,
    packing: "Box of 2 Inhalers",
  });

  expect(inhaler).toMatchObject({ strength: "200mcg / 6mcg", form: "inhaler", unitsPerPack: 2 });

  expect(
    mapMedbuzzProduct({
      productName: "EXAMPLE POWDER",
      genericName: null,
      manufacturedBy: null,
      packing: "Bottle of 100 gms",
    }).unitsPerPack,
  ).toBeNull();
});

test("Truemeds counts Units strips but not measured bottles", () => {
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
    unitsPerPack: 10,
    packSizeLabel: "Strip of 10 Units",
  });

  expect(
    mapTruemedsProduct({ ...strip, packSize: "5", unit: "ML", packForm: "Bottle of 5 ML" })
      .unitsPerPack,
  ).toBeNull();
});

test("merge ranks the typed brand first, keeps source order, and de-duplicates by name", () => {
  const suggestion = (name: string) => ({
    ...second,
    name,
    unitsPerPack: null,
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
