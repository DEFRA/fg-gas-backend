import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { fetchConfigFile } from "../../common/s3-client.js";
import {
  findAgreementDefinition,
  insertAgreementDefinition,
} from "../repositories/agreement-definition.repository.js";
import {
  canLoadDefinitionForCreation,
  clearAgreementDefinitionCaches,
  loadAgreementDefinition,
  loadDefinitionForAgreement,
} from "./load-agreement-definition.js";

vi.mock("../../common/config-broker/config-catalog.repository.js");
vi.mock("../../common/s3-client.js");
vi.mock("../repositories/agreement-definition.repository.js");

const validDefinition = {
  code: "test-code",
  agreementNumberPrefix: "TST",
  create: {
    target: "offered",
    application: "$.input.application",
    values: { actions: [], items: [] },
  },
  states: {
    offered: {
      page: "offered",
      on: { accept: { target: "accepted" } },
    },
    accepted: { page: "offered" },
  },
  pages: {
    offered: {
      title: "Offered page",
      components: [{ component: "heading", level: 1, text: "Offered" }],
    },
  },
};

const target = (version) => ({
  grantCode: "test-code",
  version,
  status: "active",
  major: 1,
  minor: 0,
  patch: Number(version.split(".")[2]),
  s3Bucket: "bucket",
  s3Key: `test-code/${version}/gas/agreement.json`,
  fetchStatus: FetchStatus.Pending,
  fetchAttempts: 0,
});

describe("loadAgreementDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgreementDefinitionCaches();
    findAgreementDefinition.mockResolvedValue(null);
    fetchConfigFile.mockResolvedValue(validDefinition);
    insertAgreementDefinition.mockResolvedValue({ insertedId: "definition" });
    updateDefinitionFetchStatus.mockResolvedValue({ modifiedCount: 1 });
  });

  it("loads an exact definition from S3 and records it as fetched", async () => {
    findConfigDefinition.mockResolvedValue(target("1.0.1"));

    const definition = await loadAgreementDefinition({
      code: "test-code",
      configVersion: "1.0.1",
      resolution: "exact",
    });

    expect(definition.configVersion).toBe("1.0.1");
    expect(fetchConfigFile).toHaveBeenCalledWith(
      "bucket",
      "test-code/1.0.1/gas/agreement.json",
    );
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ fetchStatus: FetchStatus.Fetched }),
    );
  });

  it("resolves offered Agreements to the latest usable same-major version", async () => {
    findLatestUsableDefinition.mockResolvedValue(target("1.0.2"));

    const definition = await loadAgreementDefinition({
      code: "test-code",
      configVersion: "1.0.0",
      resolution: "same-major",
    });

    expect(definition.configVersion).toBe("1.0.2");
    expect(findLatestUsableDefinition).toHaveBeenCalledWith({
      grantCode: "test-code",
      major: 1,
      definitionType: "agreement",
    });
  });

  it("falls back at creation without selecting a newer version", async () => {
    findConfigDefinition.mockResolvedValue(null);
    findLatestUsableDefinition.mockResolvedValue(target("1.0.3"));

    const definition = await loadAgreementDefinition({
      code: "test-code",
      configVersion: "1.0.4",
      resolution: "creation",
    });

    expect(definition.configVersion).toBe("1.0.3");
    expect(findLatestUsableDefinition).toHaveBeenCalledWith({
      grantCode: "test-code",
      major: 1,
      minor: 0,
      patch: 4,
      definitionType: "agreement",
    });
  });

  it("rejects a definition published for another grant", async () => {
    findConfigDefinition.mockResolvedValue(target("1.0.5"));
    fetchConfigFile.mockResolvedValue({
      ...validDefinition,
      code: "other-code",
    });

    await expect(
      loadAgreementDefinition({
        code: "test-code",
        configVersion: "1.0.5",
        resolution: "exact",
      }),
    ).rejects.toThrow('does not match "test-code"');
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ fetchStatus: FetchStatus.PermanentError }),
    );
  });

  it("records transient cache failures without poisoning the definition", async () => {
    findConfigDefinition.mockResolvedValue(target("1.0.7"));
    insertAgreementDefinition.mockRejectedValue(new Error("Mongo unavailable"));

    await expect(
      loadAgreementDefinition({
        code: "test-code",
        configVersion: "1.0.7",
        resolution: "exact",
      }),
    ).rejects.toThrow("Mongo unavailable");
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ fetchStatus: FetchStatus.TransientError }),
    );
  });

  it("rejects an unavailable exact definition", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(
      loadAgreementDefinition({
        code: "test-code",
        configVersion: "1.0.6",
        resolution: "exact",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
  });

  describe("fallback after an unusable definition", () => {
    const invalidDefinition = { ...validDefinition, code: "other-code" };

    it("falls back to an older version when the newest is invalid", async () => {
      findLatestUsableDefinition
        .mockResolvedValueOnce(target("1.0.2"))
        .mockResolvedValue(target("1.0.1"));
      fetchConfigFile
        .mockResolvedValueOnce(invalidDefinition)
        .mockResolvedValue(validDefinition);

      const definition = await loadAgreementDefinition({
        code: "test-code",
        configVersion: "1.0.0",
        resolution: "same-major",
      });

      expect(definition.configVersion).toBe("1.0.1");
      expect(findLatestUsableDefinition).toHaveBeenCalledTimes(2);
      expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "1.0.2",
          fetchStatus: FetchStatus.PermanentError,
        }),
      );
    });

    it("falls back at creation when the newest usable version is invalid", async () => {
      findConfigDefinition.mockResolvedValue(null);
      findLatestUsableDefinition
        .mockResolvedValueOnce(target("1.0.3"))
        .mockResolvedValue(target("1.0.2"));
      fetchConfigFile
        .mockResolvedValueOnce(invalidDefinition)
        .mockResolvedValue(validDefinition);

      const definition = await loadAgreementDefinition({
        code: "test-code",
        configVersion: "1.0.4",
        resolution: "creation",
      });

      expect(definition.configVersion).toBe("1.0.2");
    });

    // A service fault must not be laundered into a silent config downgrade.
    it("rethrows a transient failure without falling back", async () => {
      findLatestUsableDefinition.mockResolvedValue(target("1.0.2"));
      insertAgreementDefinition.mockRejectedValue(new Error("Mongo down"));

      await expect(
        loadAgreementDefinition({
          code: "test-code",
          configVersion: "1.0.0",
          resolution: "same-major",
        }),
      ).rejects.toThrow("Mongo down");
      expect(findLatestUsableDefinition).toHaveBeenCalledTimes(1);
    });

    it("never falls back for an exact resolution", async () => {
      findConfigDefinition.mockResolvedValue(target("1.0.5"));
      fetchConfigFile.mockResolvedValue(invalidDefinition);

      await expect(
        loadAgreementDefinition({
          code: "test-code",
          configVersion: "1.0.5",
          resolution: "exact",
        }),
      ).rejects.toThrow('does not match "test-code"');
      expect(findConfigDefinition).toHaveBeenCalledTimes(1);
      expect(findLatestUsableDefinition).not.toHaveBeenCalled();
    });

    // Exhausting the cap is the same outcome as finding nothing, so it must
    // surface the normal unavailable error, not the last validation failure.
    it("reports unavailable once every attempt is invalid", async () => {
      findLatestUsableDefinition
        .mockResolvedValueOnce(target("1.0.3"))
        .mockResolvedValueOnce(target("1.0.2"))
        .mockResolvedValue(target("1.0.1"));
      fetchConfigFile.mockResolvedValue(invalidDefinition);

      await expect(
        loadAgreementDefinition({
          code: "test-code",
          configVersion: "1.0.0",
          resolution: "same-major",
        }),
      ).rejects.toMatchObject({
        output: { statusCode: 500 },
        message: expect.stringContaining("is unavailable"),
      });
      expect(findLatestUsableDefinition).toHaveBeenCalledTimes(3);
      expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "1.0.1",
          fetchStatus: FetchStatus.PermanentError,
        }),
      );
    });

    it("gives up once no usable version remains", async () => {
      findLatestUsableDefinition
        .mockResolvedValueOnce(target("1.0.2"))
        .mockResolvedValue(null);
      fetchConfigFile.mockResolvedValue(invalidDefinition);

      await expect(
        loadAgreementDefinition({
          code: "test-code",
          configVersion: "1.0.0",
          resolution: "same-major",
        }),
      ).rejects.toMatchObject({ output: { statusCode: 500 } });
    });
  });

  // Routing must not claim a grant on the strength of a definition the
  // application's config version could never resolve to.
  describe("canLoadDefinitionForCreation", () => {
    it("is true when the config version resolves to a usable definition", async () => {
      findConfigDefinition.mockResolvedValue(target("1.0.1"));

      await expect(
        canLoadDefinitionForCreation({
          code: "test-code",
          configVersion: "1.0.1",
        }),
      ).resolves.toBe(true);
    });

    it("is false when only an incompatible version publishes a definition", async () => {
      findConfigDefinition.mockResolvedValue(null);
      findLatestUsableDefinition.mockResolvedValue(null);

      await expect(
        canLoadDefinitionForCreation({
          code: "test-code",
          configVersion: "1.0.2",
        }),
      ).resolves.toBe(false);
    });

    it("is false for an unparseable config version", async () => {
      await expect(
        canLoadDefinitionForCreation({
          code: "test-code",
          configVersion: null,
        }),
      ).resolves.toBe(false);
    });

    // A database fault must fail the command, not silently divert it.
    it("rethrows a non-Boom failure rather than routing externally", async () => {
      findConfigDefinition.mockRejectedValue(new Error("Mongo down"));

      await expect(
        canLoadDefinitionForCreation({
          code: "test-code",
          configVersion: "1.0.3",
        }),
      ).rejects.toThrow("Mongo down");
    });
  });

  describe("loadDefinitionForAgreement", () => {
    const agreement = (acceptedAt) => ({
      code: "test-code",
      configVersion: "1.0.1",
      acceptedAt,
    });

    it("pins an accepted Agreement to the version it was accepted under", async () => {
      findConfigDefinition.mockResolvedValue(target("1.0.1"));

      const definition = await loadDefinitionForAgreement(
        agreement("2026-08-01T00:00:00.000Z"),
      );

      expect(definition.configVersion).toBe("1.0.1");
      expect(findConfigDefinition).toHaveBeenCalledWith({
        grantCode: "test-code",
        version: "1.0.1",
        definitionType: "agreement",
      });
      expect(findLatestUsableDefinition).not.toHaveBeenCalled();
    });

    // The pin has to outlive the accepted state itself.
    it("keeps the pin after an accepted Agreement is terminated", async () => {
      findConfigDefinition.mockResolvedValue(target("1.0.1"));

      const definition = await loadDefinitionForAgreement({
        ...agreement("2026-08-01T00:00:00.000Z"),
        state: "terminated",
      });

      expect(definition.configVersion).toBe("1.0.1");
      expect(findLatestUsableDefinition).not.toHaveBeenCalled();
    });

    it("moves an offered Agreement to the latest compatible version", async () => {
      findLatestUsableDefinition.mockResolvedValue(target("1.0.2"));

      const definition = await loadDefinitionForAgreement(agreement(undefined));

      expect(definition.configVersion).toBe("1.0.2");
      expect(findLatestUsableDefinition).toHaveBeenCalledWith({
        grantCode: "test-code",
        major: 1,
        definitionType: "agreement",
      });
    });
  });
});
