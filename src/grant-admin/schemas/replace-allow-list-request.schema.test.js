import { describe, expect, it } from "vitest";
import { replaceAllowListRequestSchema } from "./replace-allow-list-request.schema.js";

describe("replaceAllowListRequestSchema", () => {
  it("accepts raw submitted text for both fields", () => {
    const result = replaceAllowListRequestSchema.validate({
      sbi: "106000033\n106000044",
      crn: "1042000000",
    });

    expect(result.error).toBeUndefined();
  });

  it("accepts empty fields", () => {
    const result = replaceAllowListRequestSchema.validate({
      sbi: "",
      crn: "",
    });

    expect(result.error).toBeUndefined();
  });

  it.each([
    [{ sbi: "106000033", crn: "1042000000", extra: true }],
    [{ crn: "1042000000" }],
    [{ sbi: "106000033" }],
    [{ sbi: 106000033, crn: "1042000000" }],
    [{ global: { sbi: ["106000033"], crn: ["1042000000"] } }],
  ])("refuses %j", (payload) => {
    expect(replaceAllowListRequestSchema.validate(payload).error).toBeDefined();
  });
});
