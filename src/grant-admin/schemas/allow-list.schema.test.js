import { describe, expect, it } from "vitest";
import {
  allowListGlobalSchema,
  allowListResponseSchema,
  replaceAllowListRequestSchema,
} from "./allow-list.schema.js";

const validGlobal = {
  sbi: ["106000033"],
  crn: ["1042000000"],
};

describe("allow-list schemas", () => {
  it("accepts empty identifier collections", () => {
    const result = replaceAllowListRequestSchema.validate({
      global: { sbi: [], crn: [] },
    });

    expect(result.error).toBeUndefined();
  });

  it("requires both identifier collections", () => {
    expect(
      allowListGlobalSchema.validate({ sbi: validGlobal.sbi }).error,
    ).toBeDefined();
    expect(
      allowListGlobalSchema.validate({ crn: validGlobal.crn }).error,
    ).toBeDefined();
  });

  it("refuses non-string identifiers", () => {
    expect(
      allowListGlobalSchema.validate({ sbi: [106000033], crn: [] }).error,
    ).toBeDefined();
    expect(
      allowListGlobalSchema.validate({ sbi: [], crn: [1042000000] }).error,
    ).toBeDefined();
  });

  it("leaves identifier format validation to the domain model", () => {
    const result = allowListGlobalSchema.validate({
      sbi: ["domain-validates-this"],
      crn: ["and-this"],
    });

    expect(result.error).toBeUndefined();
  });

  it.each([
    [{ global: validGlobal, windows: [] }],
    [{ global: { ...validGlobal, windows: [] } }],
    [{ global: validGlobal, extra: true }],
  ])("refuses unknown request fields", (payload) => {
    expect(replaceAllowListRequestSchema.validate(payload).error).toBeDefined();
  });

  it("accepts the canonical response", () => {
    const response = {
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
