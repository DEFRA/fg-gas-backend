import { describe, expect, it } from "vitest";
import { ReferenceDataDeclaration } from "./reference-data-declaration.js";

describe("ReferenceDataDeclaration", () => {
  it("builds an inline set from its items", () => {
    const declaration = new ReferenceDataDeclaration({
      name: "fly",
      source: {
        type: "inline",
        items: [{ code: "WINGS", description: "Wings" }],
      },
    });

    expect(declaration.inlineSet.contains("WINGS")).toBe(true);
    expect(declaration.isHeldInDb).toBe(false);
  });

  it("is held in the db for a db source", () => {
    const declaration = new ReferenceDataDeclaration({
      name: "fly",
      source: { type: "db" },
    });

    expect(declaration.isHeldInDb).toBe(true);
  });

  it("refuses an endpoint output mapping that cannot resolve", () => {
    expect(
      () =>
        new ReferenceDataDeclaration({
          name: "fly",
          source: {
            type: "endpoint",
            endpoint: { method: "GET", path: "/reference/fly", service: "PMF" },
            output: { items: { itemsRef: "$.response.options" } },
          },
        }),
    ).toThrow(/Reference data "fly" output items mapping is invalid/);
  });
});
