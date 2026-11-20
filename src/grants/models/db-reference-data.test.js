import { describe, expect, it } from "vitest";
import { DbReferenceData } from "./db-reference-data.js";

const stored = () =>
  DbReferenceData.fromDocument({
    grantCode: "pigs-might-fly",
    name: "fly-db",
    items: [{ code: "WINGS", description: "Wings" }],
    updatedAt: "2026-11-20T00:00:00.000Z",
  });

describe("DbReferenceData", () => {
  it("starts empty", () => {
    expect(DbReferenceData.empty("pigs-might-fly", "fly-db").toJSON()).toEqual({
      name: "fly-db",
      items: [],
      updatedAt: null,
    });
  });

  it("adds an item", () => {
    const referenceData = stored();

    referenceData.addItem({ code: "GLIDERS", description: "Gliders" });

    expect(referenceData.toSet().contains("GLIDERS")).toBe(true);
    expect(referenceData.updatedAt).not.toBe("2026-11-20T00:00:00.000Z");
  });

  it("refuses an item whose code it already has", () => {
    expect(() =>
      stored().addItem({ code: "WINGS", description: "Other wings" }),
    ).toThrow('Reference data "fly-db" already has an item with code "WINGS"');
  });

  it("changes an item's description, keeping its code", () => {
    const referenceData = stored();

    referenceData.changeItem("WINGS", { description: "Feathered wings" });

    expect(referenceData.toDocument().items).toEqual([
      { code: "WINGS", description: "Feathered wings" },
    ]);
  });

  it("removes an item", () => {
    const referenceData = stored();

    referenceData.removeItem("WINGS");

    expect(referenceData.items).toEqual([]);
  });

  it.each([
    [
      "changes",
      (referenceData) => referenceData.changeItem("NOPE", { description: "x" }),
    ],
    ["removes", (referenceData) => referenceData.removeItem("NOPE")],
  ])("refuses when it %s an item it does not have", (_, act) => {
    expect(() => act(stored())).toThrow(
      'Reference data "fly-db" has no item with code "NOPE"',
    );
  });

  it("round-trips through its document", () => {
    expect(DbReferenceData.fromDocument(stored().toDocument())).toEqual(
      stored(),
    );
  });
});
