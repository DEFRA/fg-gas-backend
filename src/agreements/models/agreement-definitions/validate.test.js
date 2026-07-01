import { describe, expect, it } from "vitest";
import { pmfAgreementDefinition } from "./pmf.js";
import { validateAgreementDefinition } from "./validate.js";

describe("validateAgreementDefinition", () => {
  it("returns the validated definition when it is valid", () => {
    expect(validateAgreementDefinition(pmfAgreementDefinition)).toMatchObject({
      code: "pigs-might-fly",
    });
  });

  it("throws an actionable error when the definition is missing required fields", () => {
    expect(() => validateAgreementDefinition({ code: "broken" })).toThrow(
      /Invalid agreement definition "broken"/,
    );
  });

  it("throws a 500-class error, since an invalid definition is a server config defect, not a client one", () => {
    try {
      validateAgreementDefinition({ code: "broken" });
      expect.unreachable("expected validateAgreementDefinition to throw");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
    }
  });
});
