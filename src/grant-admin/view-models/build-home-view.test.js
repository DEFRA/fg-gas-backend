import { describe, expect, it } from "vitest";
import { buildHomeView } from "./build-home-view.js";

describe("buildHomeView", () => {
  it("counts the grants the operator administers", () => {
    expect(
      buildHomeView({
        grants: [
          { code: "fptt", description: "Farming Payments" },
          { code: "woodland", description: null },
        ],
      }),
    ).toEqual({ grantTypeCount: 2 });
  });

  it("copies only the count", () => {
    expect(
      buildHomeView({
        grants: [{ code: "woodland", description: "Woodland", admin: {} }],
      }),
    ).toEqual({ grantTypeCount: 1 });
  });

  it("counts none for no grants", () => {
    expect(buildHomeView({ grants: [] })).toEqual({ grantTypeCount: 0 });
  });
});
