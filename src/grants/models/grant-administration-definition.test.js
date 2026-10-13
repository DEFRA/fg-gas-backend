import { describe, expect, it } from "vitest";
import { GrantAdministrationDefinition } from "./grant-administration-definition.js";

describe("GrantAdministrationDefinition", () => {
  it("selects the active published definition", () => {
    const activeVersion = { version: "2.3.0" };
    expect(GrantAdministrationDefinition.select({ activeVersion })).toEqual({
      kind: "published",
      version: activeVersion,
    });
  });

  it("throws notFound when there is no active published definition", () => {
    expect(() => GrantAdministrationDefinition.select({})).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );
  });
});
