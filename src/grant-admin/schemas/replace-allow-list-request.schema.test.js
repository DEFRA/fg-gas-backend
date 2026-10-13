import { describe, expect, it } from "vitest";
import { replaceAllowListRequestSchema } from "./replace-allow-list-request.schema.js";

const validGlobal = {
  sbi: ["106000033"],
  crn: ["1042000000"],
};

describe("replaceAllowListRequestSchema", () => {
  it("accepts empty identifier collections", () => {
    const result = replaceAllowListRequestSchema.validate({
      global: { sbi: [], crn: [] },
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
});
