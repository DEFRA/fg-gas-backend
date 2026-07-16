import { describe, expect, it } from "vitest";
import { findAgreementDefinition } from "./agreement-definition-registry.js";
import { pmfAgreementDefinition } from "./pmf.js";

describe("findAgreementDefinition", () => {
  it("returns the exact configured definition version", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "0.0.1",
      }),
    ).toBe(pmfAgreementDefinition);
  });

  it("returns the code-specific default when no version is requested", () => {
    expect(findAgreementDefinition({ code: "pigs-might-fly" })).toBe(
      pmfAgreementDefinition,
    );
  });

  it("returns undefined when the code is unknown", () => {
    expect(
      findAgreementDefinition({
        code: "unknown-code",
        configVersion: "0.0.1",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the version is unavailable", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "0.0.0",
      }),
    ).toBeUndefined();
  });
});
