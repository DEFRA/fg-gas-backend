import { describe, expect, it } from "vitest";
import {
  agreementDefinitions,
  findAgreementDefinition,
} from "./agreement-definition-registry.js";

const pmfAgreementDefinition = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);

describe("findAgreementDefinition", () => {
  it("returns the code-specific default when another version is requested", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "3.0.0",
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

  it("ignores an unavailable version", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "0.0.0",
      }),
    ).toBe(pmfAgreementDefinition);
  });
});
