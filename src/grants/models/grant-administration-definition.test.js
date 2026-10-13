import { describe, expect, it } from "vitest";
import { GrantAdministrationDefinition } from "./grant-administration-definition.js";

describe("GrantAdministrationDefinition", () => {
  it("prefers the active published definition to legacy", () => {
    const activeVersion = { version: "2.3.0" };
    expect(
      GrantAdministrationDefinition.select({ activeVersion, legacyGrant: {} }),
    ).toEqual({ kind: "published", version: activeVersion });
  });
  it("uses legacy when there is no active published definition", () => {
    const legacyGrant = {};
    expect(GrantAdministrationDefinition.select({ legacyGrant })).toEqual({
      kind: "legacy",
      grant: legacyGrant,
    });
  });
  it.each([
    [true, 403],
    [false, 404],
  ])(
    "distinguishes a known unusable grant from an unknown grant: %s",
    (knownGrant, statusCode) => {
      expect(() =>
        GrantAdministrationDefinition.select({ knownGrant }),
      ).toThrow(
        expect.objectContaining({
          output: expect.objectContaining({ statusCode }),
        }),
      );
    },
  );
});
