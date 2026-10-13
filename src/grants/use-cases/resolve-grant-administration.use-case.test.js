import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLatestActive } from "../repositories/config-version.repository.js";
import { fetchGrantDefinition } from "../services/resolve-config-version.service.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

vi.mock("../repositories/config-version.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const args = { grantCode: "woodland", userRoles: ["ROLE_WOODLAND_ADMIN"] };
const grant = { admin: { role: "ROLE_WOODLAND_ADMIN" } };

describe("resolveGrantAdministration", () => {
  beforeEach(() => {
    findLatestActive.mockResolvedValue(null);
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
  });

  it("denies entry when there is no active published definition", async () => {
    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("denies entry until admin.role is configured", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    fetchGrantDefinition.mockResolvedValue({ grant: {} });

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("denies a role the published definition does not grant", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    fetchGrantDefinition.mockResolvedValue({
      grant: { admin: { role: "OTHER_ROLE" } },
    });

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 403 },
    });
  });

  it("propagates a failure to load the selected definition", async () => {
    findLatestActive.mockResolvedValue({ version: "2.3.0" });
    fetchGrantDefinition.mockRejectedValue(Boom.serverUnavailable());

    await expect(resolveGrantAdministration(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
  });
});
