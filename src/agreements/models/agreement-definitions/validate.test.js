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

  it("throws when create.target does not match any state", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.create.target = "missing-state";

    expect(() => validateAgreementDefinition(definition)).toThrow(
      /"create.target" \("missing-state"\) does not match any key in "states"/,
    );
  });

  it("throws when an action target does not match any state", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.target = "also-missing";

    expect(() => validateAgreementDefinition(definition)).toThrow(
      /"states.offered.on.accept.target" \("also-missing"\) does not match any key in "states"/,
    );
  });

  it("throws when a validation.page does not match any page", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.page = "missing-page";

    expect(() => validateAgreementDefinition(definition)).toThrow(
      /"states.offered.on.accept.validation.page" \("missing-page"\) does not match any key in "pages"/,
    );
  });

  it("reports every dangling reference at once, not just the first", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.create.target = "missing-state";
    definition.states.offered.on.accept.target = "also-missing";
    definition.states.offered.on.accept.validation.page = "missing-page";

    try {
      validateAgreementDefinition(definition);
      expect.unreachable("expected validateAgreementDefinition to throw");
    } catch (error) {
      expect(error.message).toMatch(/create.target/);
      expect(error.message).toMatch(/states.offered.on.accept.target/);
      expect(error.message).toMatch(/states.offered.on.accept.validation.page/);
    }
  });
});
