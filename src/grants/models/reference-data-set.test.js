import { describe, expect, it } from "vitest";
import { ReferenceDataSet } from "./reference-data-set.js";

const fly = () =>
  new ReferenceDataSet({
    name: "fly",
    items: [
      { code: "WINGS", description: "Wings" },
      { code: "ROCKET_PACK", description: "Rocket pack" },
    ],
  });

describe("ReferenceDataSet", () => {
  it("answers whether it contains a code", () => {
    expect(fly().contains("WINGS")).toBe(true);
    expect(fly().contains("GLIDERS")).toBe(false);
  });

  it("finds an item by code", () => {
    expect(fly().find("ROCKET_PACK").description).toBe("Rocket pack");
  });

  it("serialises to its name and items", () => {
    expect(fly().toJSON()).toEqual({
      name: "fly",
      items: [
        { code: "WINGS", description: "Wings" },
        { code: "ROCKET_PACK", description: "Rocket pack" },
      ],
    });
  });

  it("refuses duplicate item codes", () => {
    expect(
      () =>
        new ReferenceDataSet({
          name: "fly",
          items: [
            { code: "WINGS", description: "Wings" },
            { code: "WINGS", description: "More wings" },
          ],
        }),
    ).toThrow('Reference data "fly" has duplicate item code "WINGS"');
  });

  it("refuses an item without a description", () => {
    expect(
      () =>
        new ReferenceDataSet({
          name: "fly",
          items: [{ code: "WINGS", description: "" }],
        }),
    ).toThrow(/Invalid reference data item/);
  });

  it("refuses an item code with spaces", () => {
    expect(
      () =>
        new ReferenceDataSet({
          name: "fly",
          items: [{ code: "BIG WINGS", description: "Big wings" }],
        }),
    ).toThrow(/letters, numbers, hyphens and underscores/);
  });
});
