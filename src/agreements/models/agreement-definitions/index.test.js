import { describe, expect, it } from "vitest";
import { getAgreementDefinitionByCode } from "./index.js";
import { pmfAgreementDefinition } from "./pmf.js";
import { validateAgreementDefinition } from "./validate.js";

describe("getAgreementDefinitionByCode", () => {
  it("returns the PMF agreement definition for code pigs-might-fly", () => {
    expect(getAgreementDefinitionByCode("pigs-might-fly")).toBe(
      pmfAgreementDefinition,
    );
  });

  it("returns undefined for an unknown agreement code", () => {
    expect(getAgreementDefinitionByCode("unknown-code")).toBeUndefined();
  });

  it("is available by code and validates successfully", () => {
    expect(() =>
      validateAgreementDefinition(
        getAgreementDefinitionByCode("pigs-might-fly"),
      ),
    ).not.toThrow();
  });
});
