import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsByGrantCode,
  findLatestActive,
} from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { fetchGrantDefinition } from "../services/resolve-config-version.service.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const args = { grantCode: "woodland", userRoles: ["ROLE_WOODLAND_ADMIN"] };
const grant = { admin: { role: "ROLE_WOODLAND_ADMIN" } };

describe("resolveGrantAdministration", () => {
  beforeEach(() => {
    findLatestActive.mockResolvedValue(null);
    findByCode.mockResolvedValue(grant);
    existsByGrantCode.mockResolvedValue(false);
  });
  it("returns an authorised legacy grant", async () => {
    await expect(resolveGrantAdministration(args)).resolves.toEqual(grant);
  });
  it("loads the selected published version once in the caller's session", async () => {
    const session = { id: "session" };
    const version = { grantCode: "woodland", version: "2.3.0" };
    findLatestActive.mockResolvedValue(version);
    fetchGrantDefinition.mockResolvedValue({ grant });
    await expect(resolveGrantAdministration(args, session)).resolves.toEqual(
      grant,
    );
    expect(findLatestActive).toHaveBeenCalledWith("woodland", session);
    expect(fetchGrantDefinition).toHaveBeenCalledWith(version, session);
    expect(findByCode).not.toHaveBeenCalled();
  });
  it("uses the caller's session for the legacy fallback", async () => {
    const session = {};
    await resolveGrantAdministration(args, session);
    expect(findByCode).toHaveBeenCalledWith("woodland", "0.0.0", session);
  });
  it.each([
    [false, 404],
    [true, 403],
  ])(
    "distinguishes unknown and known unusable grants: %s",
    async (knownGrant, statusCode) => {
      findByCode.mockResolvedValue(null);
      existsByGrantCode.mockResolvedValue(knownGrant);
      await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
        output: { statusCode },
      });
    },
  );
  it("denies entry until admin.role is configured", async () => {
    findByCode.mockResolvedValue({});
    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });
  it("does not fall back to legacy when the selected definition fails to load", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    fetchGrantDefinition.mockRejectedValue(Boom.serverUnavailable());
    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    expect(findByCode).not.toHaveBeenCalled();
  });
  it("denies a role allowed only by the old legacy definition", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    fetchGrantDefinition.mockResolvedValue({
      grant: { admin: { role: "NEW_ROLE" } },
    });
    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });
});
