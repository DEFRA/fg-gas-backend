import { describe, expect, it } from "vitest";
import { allowListGlobalSchema } from "./allow-list-global.schema.js";

const validGlobal = {
  sbi: ["106000033"],
  crn: ["1042000000"],
};

describe("allowListGlobalSchema", () => {
  it("passes exact empty strings to the domain normalizer", () => {
    const result = allowListGlobalSchema.validate({
      sbi: ["", "   "],
      crn: [""],
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
});
