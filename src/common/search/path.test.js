import { describe, expect, it } from "vitest";
import { parsePath, valuesAt } from "./path.js";

const at = (view, path) => valuesAt(view, parsePath(path));

describe("parsePath", () => {
  it("reads names and every-element markers", () => {
    expect(parsePath("$.answers.landParcels[*].parcelId")).toEqual([
      { name: "answers", each: false },
      { name: "landParcels", each: true },
      { name: "parcelId", each: false },
    ]);
  });

  it.each([
    "answers.name",
    "$",
    "$.",
    "$.answers..name",
    "$.answers[0].name",
    "$.answers['name']",
    "$.answers.*",
    "$.answers.name[*][*]",
    "$.answers.1name",
    "$.answers.name ",
    42,
  ])("refuses %j", (text) => {
    expect(parsePath(text)).toBeNull();
  });
});

describe("valuesAt", () => {
  const view = {
    answers: {
      business: { name: "Hilltop Farm" },
      parcels: [{ id: "SX1" }, { id: "SX2" }, { other: 1 }, "loose"],
      tags: ["a", "b"],
    },
  };

  it("reaches one value", () => {
    expect(at(view, "$.answers.business.name")).toEqual(["Hilltop Farm"]);
  });

  it("reaches every element's value", () => {
    expect(at(view, "$.answers.parcels[*].id")).toEqual(["SX1", "SX2"]);
  });

  it("answers an array reached without [*] as one value", () => {
    expect(at(view, "$.answers.tags")).toEqual([["a", "b"]]);
  });

  it("takes a value under [*] that is not an array as its only element", () => {
    expect(at(view, "$.answers.business[*].name")).toEqual(["Hilltop Farm"]);
  });

  it("reaches nothing down a missing or non-object branch", () => {
    expect(at(view, "$.answers.missing.name")).toEqual([]);
    expect(at(view, "$.answers.business.name.first")).toEqual([]);
  });

  it("never reaches an inherited property", () => {
    expect(at(view, "$.answers.constructor")).toEqual([]);
    expect(at({ answers: {} }, "$.answers.toString")).toEqual([]);
  });
});
