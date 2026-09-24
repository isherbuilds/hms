import { expect, test } from "bun:test";

import { mapOneMgSuggestion } from "../../packages/api/src/lib/onemg";

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

test("1mg marketer never substitutes for manufacturer", () => {
  const result = {
    type: "drug",
    id: 1,
    label: "Example medicine",
    strength: "500 mg",
    pack_form: "tablet",
    pack_size_label: "10 tablets",
    units_in_pack: 10,
    marketer_name: "Seller",
    manufacturer_name: "Factory",
    product_type: "medicine",
  };

  expect(mapOneMgSuggestion(result).manufacturer).toBe("Factory");
  expect(mapOneMgSuggestion({ ...result, manufacturer_name: null }).manufacturer).toBeNull();
});
