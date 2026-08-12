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
import { loadAgreementDefinition } from "./load-agreement-definition.js";

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
});
