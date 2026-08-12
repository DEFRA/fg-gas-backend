import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus } from "../fetch-status.js";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
  upsertDefinitionLocation,
} from "./config-catalog.repository.js";

const collection = {
  findOne: vi.fn(),
  updateOne: vi.fn(),
};

vi.mock("../mongo-client.js", () => ({
  db: { collection: () => collection },
}));

const document = {
  grantCode: "woodland",
  version: "1.2.3",
  major: 1,
  minor: 2,
  patch: 3,
  status: "active",
  s3Bucket: "bucket",
  definitions: {
    agreement: {
      s3Key: "woodland/1.2.3/gas/agreement.json",
      fetchStatus: FetchStatus.Pending,
      fetchAttempts: 0,
    },
  },
};

describe("config catalog repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds and flattens an exact definition", async () => {
    collection.findOne.mockResolvedValue(document);

    await expect(
      findConfigDefinition({
        grantCode: "woodland",
        version: "1.2.3",
        definitionType: "agreement",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        version: "1.2.3",
        s3Bucket: "bucket",
        s3Key: "woodland/1.2.3/gas/agreement.json",
      }),
    );
  });

  it("returns null when the requested definition type is absent", async () => {
    collection.findOne.mockResolvedValue({ ...document, definitions: {} });

    await expect(
      findConfigDefinition({
        grantCode: "woodland",
        version: "1.2.3",
        definitionType: "agreement",
      }),
    ).resolves.toBeNull();
  });

  it("finds the latest active usable definition within a major", async () => {
    collection.findOne.mockResolvedValue(document);

    await findLatestUsableDefinition({
      grantCode: "woodland",
      major: 1,
      definitionType: "agreement",
    });

    expect(collection.findOne).toHaveBeenCalledWith(
      {
        grantCode: "woodland",
        major: 1,
        status: "active",
        "definitions.agreement.s3Key": { $exists: true },
        "definitions.agreement.fetchStatus": {
          $ne: FetchStatus.PermanentError,
        },
      },
      { sort: { minor: -1, patch: -1 }, readPreference: "primary" },
    );
  });

  it("bounds creation fallback to the requested minor and patch", async () => {
    collection.findOne.mockResolvedValue(document);

    await findLatestUsableDefinition({
      grantCode: "woodland",
      major: 1,
      minor: 2,
      patch: 3,
      definitionType: "agreement",
    });

    expect(collection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        major: 1,
        $or: [{ minor: { $lt: 2 } }, { minor: 2, patch: { $lte: 3 } }],
      }),
      { sort: { minor: -1, patch: -1 }, readPreference: "primary" },
    );
  });

  it("upserts location without resetting existing fetch state", async () => {
    await upsertDefinitionLocation({
      grantCode: "woodland",
      version: "1.2.3",
      definitionType: "agreement",
      s3Key: "woodland/1.2.3/gas/agreement.json",
    });

    expect(collection.updateOne).toHaveBeenCalledWith(
      { grantCode: "woodland", version: "1.2.3" },
      [
        {
          $set: {
            "definitions.agreement": {
              $mergeObjects: [
                expect.objectContaining({
                  fetchStatus: FetchStatus.Pending,
                  fetchAttempts: 0,
                }),
                { $ifNull: ["$definitions.agreement", {}] },
                { s3Key: "woodland/1.2.3/gas/agreement.json" },
              ],
            },
          },
        },
      ],
      { upsert: true },
    );
  });

  it("updates only the selected definition fetch state", async () => {
    await updateDefinitionFetchStatus({
      grantCode: "woodland",
      version: "1.2.3",
      definitionType: "agreement",
      fetchStatus: FetchStatus.TransientError,
      fetchError: "timeout",
    });

    expect(collection.updateOne).toHaveBeenCalledWith(
      { grantCode: "woodland", version: "1.2.3" },
      {
        $set: expect.objectContaining({
          "definitions.agreement.fetchStatus": FetchStatus.TransientError,
          "definitions.agreement.fetchError": "timeout",
        }),
        $inc: { "definitions.agreement.fetchAttempts": 1 },
      },
    );
  });
});
