import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_FULL,
  ACCESS_HIDDEN,
  ACCESS_VIEW_ONLY,
} from "../models/claims-access.js";
import {
  requireClaimsChange,
  requireClaimsView,
  resolveClaimsAccess,
} from "./claims-access.js";

const requiredRoles = { allOf: ["ROLE_WMP", "ROLE_WMP_CLAIMS"], anyOf: [] };
const restrictedGrant = { claims: { requiredRoles } };
const unrestrictedGrants = [
  ["no claims configured", {}],
  ["claims with no required roles", { claims: {} }],
];

const findHeldRoles = vi.fn();

const forbidden = { output: { statusCode: 403 } };

describe("claims access", () => {
  beforeEach(() => {
    findHeldRoles.mockReset();
  });

  describe("resolveClaimsAccess", () => {
    it.each(unrestrictedGrants)(
      "is full without reading the operator's roles for a grant with %s",
      async (_, grant) => {
        await expect(resolveClaimsAccess(grant, findHeldRoles)).resolves.toBe(
          ACCESS_FULL,
        );
        expect(findHeldRoles).not.toHaveBeenCalled();
      },
    );

    it("is full when the operator satisfies the required roles", async () => {
      findHeldRoles.mockResolvedValue(["ROLE_WMP", "ROLE_WMP_CLAIMS"]);

      await expect(
        resolveClaimsAccess(restrictedGrant, findHeldRoles),
      ).resolves.toBe(ACCESS_FULL);
      expect(findHeldRoles).toHaveBeenCalledTimes(1);
    });

    it("is view-only when the operator holds other roles", async () => {
      findHeldRoles.mockResolvedValue(["ROLE_WMP"]);

      await expect(
        resolveClaimsAccess(restrictedGrant, findHeldRoles),
      ).resolves.toBe(ACCESS_VIEW_ONLY);
    });

    it("is hidden when the operator holds no roles", async () => {
      findHeldRoles.mockResolvedValue([]);

      await expect(
        resolveClaimsAccess(restrictedGrant, findHeldRoles),
      ).resolves.toBe(ACCESS_HIDDEN);
    });

    it("passes on a failure to determine the operator's roles", async () => {
      const failure = new Error("roles unknown");
      findHeldRoles.mockRejectedValue(failure);

      await expect(
        resolveClaimsAccess(restrictedGrant, findHeldRoles),
      ).rejects.toBe(failure);
    });
  });

  describe("requireClaimsView", () => {
    it.each([
      [["ROLE_WMP", "ROLE_WMP_CLAIMS"], ACCESS_FULL],
      [["ROLE_WMP"], ACCESS_VIEW_ONLY],
    ])("answers the access of an operator holding %j", async (held, access) => {
      findHeldRoles.mockResolvedValue(held);

      await expect(
        requireClaimsView(restrictedGrant, findHeldRoles),
      ).resolves.toBe(access);
    });

    it("refuses an operator holding no roles", async () => {
      findHeldRoles.mockResolvedValue([]);

      await expect(
        requireClaimsView(restrictedGrant, findHeldRoles),
      ).rejects.toMatchObject(forbidden);
    });

    it.each(unrestrictedGrants)(
      "never asks for roles for a grant with %s",
      async (_, grant) => {
        await requireClaimsView(grant, findHeldRoles);

        expect(findHeldRoles).not.toHaveBeenCalled();
      },
    );
  });

  describe("requireClaimsChange", () => {
    it("allows an operator holding the required roles", async () => {
      findHeldRoles.mockResolvedValue(["ROLE_WMP", "ROLE_WMP_CLAIMS"]);

      await expect(
        requireClaimsChange(restrictedGrant, findHeldRoles),
      ).resolves.toBe(ACCESS_FULL);
    });

    it.each([[["ROLE_WMP"]], [[]]])(
      "refuses an operator holding %j",
      async (held) => {
        findHeldRoles.mockResolvedValue(held);

        await expect(
          requireClaimsChange(restrictedGrant, findHeldRoles),
        ).rejects.toMatchObject(forbidden);
      },
    );

    it.each(unrestrictedGrants)(
      "never asks for roles for a grant with %s",
      async (_, grant) => {
        await requireClaimsChange(grant, findHeldRoles);

        expect(findHeldRoles).not.toHaveBeenCalled();
      },
    );

    it("passes on a failure to determine the operator's roles", async () => {
      const failure = new Error("roles unknown");
      findHeldRoles.mockRejectedValue(failure);

      await expect(
        requireClaimsChange(restrictedGrant, findHeldRoles),
      ).rejects.toBe(failure);
    });
  });
});
