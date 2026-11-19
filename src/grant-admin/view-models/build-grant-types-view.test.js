import { describe, expect, it } from "vitest";
import { buildGrantTypesView } from "./build-grant-types-view.js";

describe("buildGrantTypesView", () => {
  it("names each grant type by its description, in the order given", () => {
    expect(
      buildGrantTypesView({
        grants: [
          { code: "fptt", description: "Farming Payments" },
          { code: "woodland", description: null },
        ],
      }),
    ).toEqual({
      grantTypes: [
        { code: "fptt", name: "Farming Payments" },
        { code: "woodland", name: null },
      ],
    });
  });

  it("copies only the code and name", () => {
    expect(
      buildGrantTypesView({
        grants: [{ code: "woodland", description: "Woodland", admin: {} }],
      }),
    ).toEqual({ grantTypes: [{ code: "woodland", name: "Woodland" }] });
  });

  it("answers no grant types for no grants", () => {
    expect(buildGrantTypesView({ grants: [] })).toEqual({ grantTypes: [] });
  });
});
