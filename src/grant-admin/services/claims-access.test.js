import { describe, expect, it } from "vitest";
import {
  ACCESS_FULL,
  ACCESS_HIDDEN,
  ACCESS_VIEW_ONLY,
  assertFullAccess,
  assertNotHidden,
  resolveClaimsAccess,
  satisfies,
  userRolesOf,
} from "./claims-access.js";

describe("satisfies", () => {
  it("is true when allOf and anyOf are both empty", () => {
    expect(satisfies(["ROLE_A"], { allOf: [], anyOf: [] })).toBe(true);
  });

  it("requires every allOf role", () => {
    expect(satisfies(["A", "B"], { allOf: ["A", "B"], anyOf: [] })).toBe(true);
    expect(satisfies(["A"], { allOf: ["A", "B"], anyOf: [] })).toBe(false);
  });

  it("requires at least one anyOf role", () => {
    expect(satisfies(["X"], { allOf: [], anyOf: ["X", "Y"] })).toBe(true);
    expect(satisfies(["Z"], { allOf: [], anyOf: ["X", "Y"] })).toBe(false);
  });

  it("is false when heldRoles is empty or not an array", () => {
    expect(satisfies([], { allOf: [], anyOf: [] })).toBe(false);
    expect(satisfies(null, { allOf: [], anyOf: [] })).toBe(false);
  });
});

describe("resolveClaimsAccess", () => {
  const claimsRoles = { allOf: ["ROLE_WMP", "ROLE_WMP_CLAIMS"], anyOf: [] };

  it("is full when no claims roles are configured (opt-in model)", () => {
    expect(resolveClaimsAccess(["ANY"], null)).toBe(ACCESS_FULL);
    expect(resolveClaimsAccess([], undefined)).toBe(ACCESS_FULL);
  });

  it("is full when user satisfies claimsRequiredRoles", () => {
    expect(
      resolveClaimsAccess(["ROLE_WMP", "ROLE_WMP_CLAIMS"], claimsRoles),
    ).toBe(ACCESS_FULL);
  });

  it("is view-only when user has roles but not the claims roles", () => {
    expect(resolveClaimsAccess(["ROLE_WMP"], claimsRoles)).toBe(
      ACCESS_VIEW_ONLY,
    );
    expect(resolveClaimsAccess(["ROLE_OTHER"], claimsRoles)).toBe(
      ACCESS_VIEW_ONLY,
    );
  });

  it("is hidden when user has no roles at all", () => {
    expect(resolveClaimsAccess([], claimsRoles)).toBe(ACCESS_HIDDEN);
    expect(resolveClaimsAccess(null, claimsRoles)).toBe(ACCESS_HIDDEN);
  });
});

describe("userRolesOf", () => {
  it("parses comma-separated roles from x-user-roles header", () => {
    expect(
      userRolesOf({ headers: { "x-user-roles": "ROLE_A,ROLE_B" } }),
    ).toEqual(["ROLE_A", "ROLE_B"]);
  });

  it("trims whitespace", () => {
    expect(
      userRolesOf({ headers: { "x-user-roles": " ROLE_A , ROLE_B " } }),
    ).toEqual(["ROLE_A", "ROLE_B"]);
  });

  it("returns empty array when header is absent", () => {
    expect(userRolesOf({ headers: {} })).toEqual([]);
  });

  it("returns empty array when header is empty string", () => {
    expect(userRolesOf({ headers: { "x-user-roles": "" } })).toEqual([]);
  });
});

describe("assertFullAccess", () => {
  it("does not throw for full access", () => {
    expect(() => assertFullAccess(ACCESS_FULL)).not.toThrow();
  });

  it("throws 403 for view-only", () => {
    expect(() => assertFullAccess(ACCESS_VIEW_ONLY)).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 403 }),
      }),
    );
  });

  it("throws 403 for hidden", () => {
    expect(() => assertFullAccess(ACCESS_HIDDEN)).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 403 }),
      }),
    );
  });
});

describe("assertNotHidden", () => {
  it("does not throw for full or view-only", () => {
    expect(() => assertNotHidden(ACCESS_FULL)).not.toThrow();
    expect(() => assertNotHidden(ACCESS_VIEW_ONLY)).not.toThrow();
  });

  it("throws 403 for hidden", () => {
    expect(() => assertNotHidden(ACCESS_HIDDEN)).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 403 }),
      }),
    );
  });
});
