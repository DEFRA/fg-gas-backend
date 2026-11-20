import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";

describe("Grant reference data", () => {
  it("has none unless it declares some", () => {
    expect(createTestGrant().referenceData).toEqual([]);
  });

  it("finds a declared set by name", () => {
    const grant = createTestGrant({
      referenceData: [
        { name: "fly-db", source: { type: "db" } },
        {
          name: "fly-inline",
          source: {
            type: "inline",
            items: [{ code: "WINGS", description: "Wings" }],
          },
        },
      ],
    });

    expect(grant.findReferenceData("fly-inline").type).toBe("inline");
    expect(grant.findReferenceData("missing")).toBeUndefined();
  });

  it("refuses a name declared twice", () => {
    expect(() =>
      createTestGrant({
        referenceData: [
          { name: "fly", source: { type: "db" } },
          { name: "fly", source: { type: "db" } },
        ],
      }),
    ).toThrow(
      'Grant "test-grant" declares reference data "fly" more than once',
    );
  });
});
