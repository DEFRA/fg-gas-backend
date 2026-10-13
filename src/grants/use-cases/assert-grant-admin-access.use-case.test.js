import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLatestActive } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";
import { assertGrantAdminAccess } from "./assert-grant-admin-access.use-case.js";

vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../services/resolve-config-version.service.js");
vi.mock("./assert-grant-exists.use-case.js");

const args = { grantCode: "woodland", userRoles: ["ROLE_WOODLAND_ADMIN"] };
const grant = { admin: { role: "ROLE_WOODLAND_ADMIN" } };

describe("assertGrantAdminAccess", () => {
  beforeEach(() => {
    assertGrantExists.mockResolvedValue();
    findLatestActive.mockResolvedValue(null);
    findByCode.mockResolvedValue(grant);
  });

  it("checks the legacy definition when no active version is published", async () => {
    await expect(assertGrantAdminAccess(args)).resolves.toBeUndefined();
  });

  it("uses the latest active definition instead of legacy permissions", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    resolveAndFetchGrant.mockResolvedValue({
      grant: { admin: { role: "NEW_ADMIN" } },
    });
    await expect(assertGrantAdminAccess(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
    expect(resolveAndFetchGrant).toHaveBeenCalledWith(
      "woodland",
      "2.3.0",
      undefined,
    );
    expect(findByCode).not.toHaveBeenCalled();
  });

  it("joins the caller's transaction for every definition read", async () => {
    const session = { id: "active-session" };
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    resolveAndFetchGrant.mockResolvedValue({ grant });

    await assertGrantAdminAccess(args, session);

    expect(findLatestActive).toHaveBeenCalledWith("woodland", session);
    expect(resolveAndFetchGrant).toHaveBeenCalledWith(
      "woodland",
      "2.3.0",
      session,
    );
  });

  it("joins the caller's transaction for the legacy fallback read", async () => {
    const session = { id: "active-session" };

    await assertGrantAdminAccess(args, session);

    expect(findByCode).toHaveBeenCalledWith("woodland", "0.0.0", session);
  });

  it("denies entry until the grant has an admin role", async () => {
    findByCode.mockResolvedValue({});
    await expect(assertGrantAdminAccess(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("preserves 404 for unknown grants", async () => {
    assertGrantExists.mockRejectedValue(Boom.notFound());
    await expect(assertGrantAdminAccess(args)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(findLatestActive).not.toHaveBeenCalled();
  });

  it("does not fall back to older permissions when definition loading fails", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    resolveAndFetchGrant.mockRejectedValue(Boom.serverUnavailable());
    await expect(assertGrantAdminAccess(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    expect(findByCode).not.toHaveBeenCalled();
  });
});
