import { describe, expect, it } from "vitest";
import { allowListResponseSchema } from "./allow-list-response.schema.js";

const validGlobal = {
  sbi: ["106000033"],
  crn: ["1042000000"],
};

describe("allowListResponseSchema", () => {
  it("accepts the canonical response", () => {
    const response = {
      adminRole: "ROLE_WOODLAND_ADMIN",
      grantCode: "woodland",
      global: validGlobal,
    };

    expect(allowListResponseSchema.validate(response)).toEqual({
      value: response,
    });
  });

  it("requires a valid grant code in the response", () => {
    expect(
      allowListResponseSchema.validate({
        grantCode: "Woodland!",
        global: validGlobal,
      }).error,
    ).toBeDefined();
  });
});
