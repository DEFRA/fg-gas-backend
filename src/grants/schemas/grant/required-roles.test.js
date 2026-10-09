import { describe, expect, it } from "vitest";
import { requiredRoles } from "./required-roles.js";

describe("requiredRoles schema", () => {
  it("accepts a valid required roles object", () => {
    const { error, value } = requiredRoles.validate({
      allOf: ["ROLE_WMP"],
      anyOf: ["ROLE_WMP_CLAIMS"],
    });

    expect(error).toBeUndefined();
    expect(value).toEqual({
      allOf: ["ROLE_WMP"],
      anyOf: ["ROLE_WMP_CLAIMS"],
    });
  });

  it("defaults allOf and anyOf to empty arrays", () => {
    const { error, value } = requiredRoles.validate({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ allOf: [], anyOf: [] });
  });

  it("rejects unknown keys", () => {
    const { error } = requiredRoles.validate({ allOf: [], extra: true });

    expect(error).toBeDefined();
  });
});
