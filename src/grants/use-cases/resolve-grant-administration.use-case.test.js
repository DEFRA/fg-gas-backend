import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

vi.mock("../services/resolve-config-version.service.js");

const findUserRoles = vi.fn();
const args = { grantCode: "woodland", findUserRoles };
const grant = { admin: { role: "ROLE_WOODLAND_ADMIN" } };

describe("resolveGrantAdministration", () => {
  beforeEach(() => {
    resolveAndFetchGrant.mockResolvedValue({ grant });
    findUserRoles.mockResolvedValue(["ROLE_WOODLAND_ADMIN"]);
  });

  it("uses the shared grant resolver before checking administration access", async () => {
    await expect(resolveGrantAdministration(args)).resolves.toBeUndefined();
    expect(resolveAndFetchGrant).toHaveBeenCalledWith("woodland");
  });

  it("denies entry when there is no active published definition", async () => {
    resolveAndFetchGrant.mockRejectedValue(Boom.notFound("Grant not found"));
    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("denies entry until admin.role is configured", async () => {
    resolveAndFetchGrant.mockResolvedValue({ grant: {} });

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("denies a role the published definition does not grant", async () => {
    resolveAndFetchGrant.mockResolvedValue({
      grant: { admin: { role: "OTHER_ROLE" } },
    });

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("passes on a failure to determine the user's roles", async () => {
    findUserRoles.mockRejectedValue(Boom.serverUnavailable("roles unknown"));

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
  });

  it.each([
    [
      "an unknown grant",
      () => Promise.reject(Boom.notFound("Grant not found")),
    ],
    ["a grant with no admin role", () => Promise.resolve({ grant: {} })],
  ])("does not look up the user's roles for %s", async (_, resolveGrant) => {
    resolveAndFetchGrant.mockImplementation(resolveGrant);

    await expect(resolveGrantAdministration(args)).rejects.toThrow();
    expect(findUserRoles).not.toHaveBeenCalled();
  });

  it("propagates a failure to load the selected definition", async () => {
    resolveAndFetchGrant.mockRejectedValue(Boom.serverUnavailable());

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
  });
});
