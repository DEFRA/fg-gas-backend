import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { logger } from "../../common/logger.js";
import { ConfigVersion } from "../models/config-version.js";
import { findLatestActiveForAll } from "../repositories/config-version.repository.js";
import { loadGrantsFromConfigVersions } from "../services/resolve-config-version.service.js";
import { findAdministeredGrantsUseCase } from "./find-administered-grants.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../repositories/config-version.repository.js");
vi.mock("../services/resolve-config-version.service.js");

const aGrant = (
  code,
  admin,
  metadata = { description: `${code} description` },
) =>
  createTestGrant({
    code,
    metadata: { ...metadata, startDate: "2023-01-01T00:00:00Z" },
    admin,
  });

const VERSIONS = [
  ConfigVersion.createMock({ grantCode: "woodland", version: "1.0.0" }),
];

describe("findAdministeredGrantsUseCase", () => {
  const findUserRoles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    findLatestActiveForAll.mockResolvedValue(VERSIONS);
    findUserRoles.mockResolvedValue(["ROLE_WOODLAND_ADMIN", "ROLE_FPTT_ADMIN"]);
  });

  it("loads the latest active version of every grant", async () => {
    loadGrantsFromConfigVersions.mockResolvedValue([]);

    await findAdministeredGrantsUseCase({ findUserRoles });

    expect(loadGrantsFromConfigVersions).toHaveBeenCalledWith(VERSIONS);
  });

  it("answers only the grants whose admin role the user holds, sorted by code", async () => {
    loadGrantsFromConfigVersions.mockResolvedValue([
      aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" }),
      aGrant("pigs-might-fly", { role: "ROLE_PIGS_ADMIN" }),
      aGrant("fptt", { role: "ROLE_FPTT_ADMIN" }),
    ]);

    expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual([
      { code: "fptt", description: "fptt description" },
      { code: "woodland", description: "woodland description" },
    ]);
    expect(findUserRoles).toHaveBeenCalledTimes(1);
  });

  it("leaves out a grant with no admin role configured", async () => {
    loadGrantsFromConfigVersions.mockResolvedValue([
      aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" }),
      aGrant("unconfigured", undefined),
    ]);

    expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual([
      { code: "woodland", description: "woodland description" },
    ]);
  });

  it("answers a missing description as null", async () => {
    loadGrantsFromConfigVersions.mockResolvedValue([
      aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" }, {}),
    ]);

    expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual([
      { code: "woodland", description: null },
    ]);
  });

  it("answers none when the user holds no grant's admin role", async () => {
    findUserRoles.mockResolvedValue([]);
    loadGrantsFromConfigVersions.mockResolvedValue([
      aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" }),
    ]);

    expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual([]);
  });

  it.each([
    ["no grants", []],
    ["no grant with an admin role", [aGrant("unconfigured", undefined)]],
  ])(
    "answers none without looking up roles when there are %s",
    async (_, grants) => {
      loadGrantsFromConfigVersions.mockResolvedValue(grants);

      expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual(
        [],
      );
      expect(findUserRoles).not.toHaveBeenCalled();
    },
  );

  it("propagates a failure to determine the user's roles", async () => {
    const unavailable = Boom.serverUnavailable("roles unavailable");
    findUserRoles.mockRejectedValue(unavailable);
    loadGrantsFromConfigVersions.mockResolvedValue([
      aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" }),
    ]);

    await expect(findAdministeredGrantsUseCase({ findUserRoles })).rejects.toBe(
      unavailable,
    );
  });

  describe("when a grant cannot be loaded", () => {
    const woodland = ConfigVersion.createMock({
      grantCode: "woodland",
      version: "1.0.0",
    });
    const broken = ConfigVersion.createMock({
      grantCode: "broken",
      version: "2.0.0",
    });

    const failingFor = (grantCode, error) => async (versions) => {
      if (versions.some((version) => version.grantCode === grantCode)) {
        throw error;
      }
      return [aGrant("woodland", { role: "ROLE_WOODLAND_ADMIN" })];
    };

    beforeEach(() => {
      findLatestActiveForAll.mockResolvedValue([woodland, broken]);
    });

    it.each([
      ["a permanent fetch failure", Boom.badGateway("Permanent error")],
      ["a transient S3 failure", Boom.serverUnavailable("Transient S3 error")],
      ["an invalid definition", Boom.badImplementation("invalid grant")],
      ["a malformed definition", new TypeError("metadata is undefined")],
    ])(
      "leaves that grant out after %s, and still lists the others",
      async (_, error) => {
        loadGrantsFromConfigVersions.mockImplementation(
          failingFor("broken", error),
        );

        expect(await findAdministeredGrantsUseCase({ findUserRoles })).toEqual([
          { code: "woodland", description: "woodland description" },
        ]);
        expect(loadGrantsFromConfigVersions).toHaveBeenCalledWith([woodland]);
        expect(loadGrantsFromConfigVersions).toHaveBeenCalledWith([broken]);
      },
    );

    it("logs the grant it leaves out", async () => {
      loadGrantsFromConfigVersions.mockImplementation(
        failingFor("broken", Boom.badGateway("Permanent error")),
      );

      await findAdministeredGrantsUseCase({ findUserRoles });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Permanent error" }),
        "Left broken@2.0.0 out of the administered grants",
      );
    });

    it("loads one by one from versions read again after the failed load", async () => {
      const brokenAfterFailure = ConfigVersion.createMock({
        grantCode: "broken",
        version: "2.0.0",
        fetchAttempts: 1,
      });
      findLatestActiveForAll
        .mockResolvedValueOnce([woodland, broken])
        .mockResolvedValueOnce([woodland, brokenAfterFailure]);
      loadGrantsFromConfigVersions.mockImplementation(
        failingFor("broken", Boom.serverUnavailable("Transient S3 error")),
      );

      await findAdministeredGrantsUseCase({ findUserRoles });

      expect(findLatestActiveForAll).toHaveBeenCalledTimes(2);
      expect(loadGrantsFromConfigVersions).toHaveBeenLastCalledWith([
        brokenAfterFailure,
      ]);
    });

    it("propagates a failure that is not the grant's own", async () => {
      const mongoDown = new Error("connection refused");
      loadGrantsFromConfigVersions.mockRejectedValue(mongoDown);

      await expect(
        findAdministeredGrantsUseCase({ findUserRoles }),
      ).rejects.toBe(mongoDown);
    });

    it("propagates a failure that is not the grant's own while loading one by one", async () => {
      const mongoDown = new Error("connection refused");
      loadGrantsFromConfigVersions
        .mockRejectedValueOnce(Boom.badGateway("Permanent error"))
        .mockRejectedValueOnce(mongoDown);

      await expect(
        findAdministeredGrantsUseCase({ findUserRoles }),
      ).rejects.toBe(mongoDown);
    });
  });
});
