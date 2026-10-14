import { describe, expect, it } from "vitest";
import { replaceAllowListRequestSchema } from "./replace-allow-list-request.schema.js";

describe("replaceAllowListRequestSchema", () => {
  it("accepts raw submitted text for both fields", () => {
    const result = replaceAllowListRequestSchema.validate({
      sbi: "900000002\n900000003",
      crn: "9000000001",
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
    [{ sbi: "900000002", crn: "9000000001", extra: true }],
    [{ crn: "9000000001" }],
    [{ sbi: "900000002" }],
    [{ sbi: 900000002, crn: "9000000001" }],
    [{ global: { sbi: ["900000002"], crn: ["9000000001"] } }],
  ])("refuses %j", (payload) => {
    expect(replaceAllowListRequestSchema.validate(payload).error).toBeDefined();
  });
});
