import { describe, expect, it } from "vitest";
import {
  ACCESS_FULL,
  ACCESS_HIDDEN,
  ACCESS_VIEW_ONLY,
  assertMayChangeClaims,
  assertMayViewClaims,
  claimsAccessFor,
  satisfies,
} from "./claims-access.js";

const forbidden = expect.objectContaining({
  output: expect.objectContaining({ statusCode: 403 }),
});

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

  it("treats a missing allOf or anyOf as empty", () => {
    expect(satisfies(["A"], { allOf: ["A"] })).toBe(true);
    expect(satisfies(["X"], { anyOf: ["X"] })).toBe(true);
  });

  it("is false when heldRoles is empty or not an array", () => {
    expect(satisfies([], { allOf: [], anyOf: [] })).toBe(false);
    expect(satisfies(null, { allOf: [], anyOf: [] })).toBe(false);
  });
});

describe("claimsAccessFor", () => {
  const requiredRoles = { allOf: ["ROLE_WMP", "ROLE_WMP_CLAIMS"], anyOf: [] };

  it.each([[null], [undefined]])(
    "is full when the grant configures no roles (%s), whoever the operator is",
    (none) => {
      expect(claimsAccessFor(none, [])).toBe(ACCESS_FULL);
      expect(claimsAccessFor(none, null)).toBe(ACCESS_FULL);
    },
  );

  it("is full when the operator satisfies the required roles", () => {
    expect(
      claimsAccessFor(requiredRoles, ["ROLE_WMP", "ROLE_WMP_CLAIMS"]),
    ).toBe(ACCESS_FULL);
  });

  it.each([[["ROLE_WMP"]], [["ROLE_OTHER"]]])(
    "is view-only when the operator holds %j but not the required roles",
    (heldRoles) => {
      expect(claimsAccessFor(requiredRoles, heldRoles)).toBe(ACCESS_VIEW_ONLY);
    },
  );

  it.each([[[]], [null], [undefined]])(
    "is hidden when the operator holds no roles at all (%j)",
    (heldRoles) => {
      expect(claimsAccessFor(requiredRoles, heldRoles)).toBe(ACCESS_HIDDEN);
    },
  );
});

describe("assertMayChangeClaims", () => {
  it("allows full access", () => {
    expect(() => assertMayChangeClaims(ACCESS_FULL)).not.toThrow();
  });

  it.each([[ACCESS_VIEW_ONLY], [ACCESS_HIDDEN]])(
    "refuses %s with a 403",
    (access) => {
      expect(() => assertMayChangeClaims(access)).toThrow(forbidden);
    },
  );
});

describe("assertMayViewClaims", () => {
  it.each([[ACCESS_FULL], [ACCESS_VIEW_ONLY]])("allows %s", (access) => {
    expect(() => assertMayViewClaims(access)).not.toThrow();
  });

  it("refuses hidden with a 403", () => {
    expect(() => assertMayViewClaims(ACCESS_HIDDEN)).toThrow(forbidden);
  });
});
