import { describe, expect, it } from "vitest";
import {
  getAgreementDefinitionByCodeAndVersion,
  getAgreementDefinitionForCreation,
} from "./index.js";
import { pmfAgreementDefinition } from "./pmf.js";

describe("getAgreementDefinitionByCodeAndVersion", () => {
  it("returns the exact configured definition version", () => {
    expect(
      getAgreementDefinitionByCodeAndVersion("pigs-might-fly", "0.0.1"),
    ).toBe(pmfAgreementDefinition);
  });

  it("returns undefined when the code is unknown", () => {
    expect(
      getAgreementDefinitionByCodeAndVersion("unknown-code", "0.0.1"),
    ).toBeUndefined();
  });

  it("returns undefined when the version is unavailable", () => {
    expect(
      getAgreementDefinitionByCodeAndVersion("pigs-might-fly", "0.0.0"),
    ).toBeUndefined();
  });
});

describe("getAgreementDefinitionForCreation", () => {
  it("returns the code-specific default when no version is requested", () => {
    expect(getAgreementDefinitionForCreation("pigs-might-fly")).toBe(
      pmfAgreementDefinition,
    );
  });
});
