import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_FULL,
  ACCESS_HIDDEN,
  ACCESS_VIEW_ONLY,
  assertFullAccess,
  assertNotHidden,
  resolveClaimsAccess,
  satisfies,
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
  const findHeldRoles = vi.fn();

  it("is full without reading the operator's roles when no claims roles are configured", async () => {
    await expect(resolveClaimsAccess(null, findHeldRoles)).resolves.toBe(
      ACCESS_FULL,
    );
    await expect(resolveClaimsAccess(undefined, findHeldRoles)).resolves.toBe(
      ACCESS_FULL,
    );
    expect(findHeldRoles).not.toHaveBeenCalled();
  });

  it("is full when the operator satisfies claimsRequiredRoles", async () => {
    findHeldRoles.mockResolvedValue(["ROLE_WMP", "ROLE_WMP_CLAIMS"]);

    await expect(resolveClaimsAccess(claimsRoles, findHeldRoles)).resolves.toBe(
      ACCESS_FULL,
    );
    expect(findHeldRoles).toHaveBeenCalledTimes(1);
  });

  it.each([[["ROLE_WMP"]], [["ROLE_OTHER"]]])(
    "is view-only when the operator holds %j but not the claims roles",
    async (heldRoles) => {
      findHeldRoles.mockResolvedValue(heldRoles);

      await expect(
        resolveClaimsAccess(claimsRoles, findHeldRoles),
      ).resolves.toBe(ACCESS_VIEW_ONLY);
    },
  );

  it("is hidden when the operator has no roles at all", async () => {
    findHeldRoles.mockResolvedValue([]);

    await expect(resolveClaimsAccess(claimsRoles, findHeldRoles)).resolves.toBe(
      ACCESS_HIDDEN,
    );
  });

  it("passes on a failure to determine the operator's roles", async () => {
    const failure = new Error("roles unknown");
    findHeldRoles.mockRejectedValue(failure);

    await expect(resolveClaimsAccess(claimsRoles, findHeldRoles)).rejects.toBe(
      failure,
    );
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
