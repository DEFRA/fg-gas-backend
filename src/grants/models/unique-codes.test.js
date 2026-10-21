import { describe, expect, it } from "vitest";
import { assertUniqueCodes } from "./unique-codes.js";

const describeCode = (code) => `phase "${code}"`;

describe("assertUniqueCodes", () => {
  it("accepts codes used once", () => {
    expect(() =>
      assertUniqueCodes([{ code: "A" }, { code: "B" }], describeCode),
    ).not.toThrow();
  });

  it("rejects a code used twice", () => {
    expect(() =>
      assertUniqueCodes(
        [{ code: "A" }, { code: "B" }, { code: "A" }],
        describeCode,
      ),
    ).toThrow('phase "A" is defined more than once');
  });
});
