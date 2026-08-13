import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchStatus } from "../fetch-status.js";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
  updateDefinitionLocation,
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
        "definitions.agreement.s3Key": { $ne: null },
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
    await updateDefinitionLocation({
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
                { s3Key: { $literal: "woodland/1.2.3/gas/agreement.json" } },
              ],
            },
          },
        },
      ],
    );
  });

  // Upserting here would create a record with no major or status, which every
  // read filters on, leaving it invisible to all queries.
  it("is not an upsert, so it cannot create a config version record", async () => {
    await updateDefinitionLocation({
      grantCode: "woodland",
      version: "1.2.3",
      definitionType: "agreement",
      s3Key: "woodland/1.2.3/gas/agreement.json",
    });

    const [, , options] = collection.updateOne.mock.calls[0];
    expect(options?.upsert).toBeFalsy();
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

  // Otherwise the counter measures every failure the version has ever had, and
  // old ones combine with a much later blip to condemn it.
  it("clears the attempt counter once a fetch succeeds", async () => {
    await updateDefinitionFetchStatus({
      grantCode: "woodland",
      version: "1.2.3",
      definitionType: "agreement",
      fetchStatus: FetchStatus.Fetched,
    });

    const [, update] = collection.updateOne.mock.calls[0];
    expect(update.$set["definitions.agreement.fetchAttempts"]).toBe(0);
    expect(update.$inc).toBeUndefined();
  });
});
