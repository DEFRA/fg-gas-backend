import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigVersion, FetchStatus } from "../models/config-version.js";
import {
  findByGrantCodeAndVersion,
  findLatestPatch,
  updateFetchStatus,
  upsert,
} from "./config-version.repository.js";

const mockCollection = {
  updateOne: vi.fn(),
  findOne: vi.fn(),
};

vi.mock("../../common/mongo-client.js", () => ({
  db: {
    collection: () => mockCollection,
  },
}));

describe("config-version.repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("upsert", () => {
    it("should upsert a config version document", async () => {
      mockCollection.updateOne.mockResolvedValue({ upsertedCount: 1 });

      const cv = ConfigVersion.new({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        s3Key: "woodland/1.2.3/grant-definition.json",
        s3Bucket: "bucket",
      });

      await upsert(cv);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { grantCode: "woodland", version: "1.2.3" },
        expect.objectContaining({
          $set: expect.objectContaining({
            major: 1,
            minor: 2,
            patch: 3,
            status: "active",
          }),
          $setOnInsert: expect.objectContaining({
            fetchStatus: FetchStatus.Pending,
            fetchAttempts: 0,
          }),
        }),
        { upsert: true },
      );
    });
  });

  describe("findLatestPatch", () => {
    it("should query for the latest active patch", async () => {
      const doc = {
        grantCode: "woodland",
        version: "1.2.5",
        major: 1,
        minor: 2,
        patch: 5,
        status: "active",
        s3Key: "woodland/1.2.5/grant-definition.json",
        s3Bucket: "bucket",
        fetchStatus: FetchStatus.Pending,
        fetchAttempts: 0,
        receivedAt: "2026-01-01T00:00:00Z",
        fetchedAt: null,
        fetchError: null,
        lastFetchAttemptAt: null,
      };
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await findLatestPatch("woodland", 1, 2);

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        {
          grantCode: "woodland",
          major: 1,
          minor: 2,
          status: "active",
          fetchStatus: { $ne: FetchStatus.PermanentError },
        },
        { sort: { patch: -1 } },
      );
      expect(result).toBeInstanceOf(ConfigVersion);
      expect(result.version).toBe("1.2.5");
    });

    it("should return null when no match exists", async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await findLatestPatch("woodland", 9, 9);
      expect(result).toBeNull();
    });
  });

  describe("updateFetchStatus", () => {
    it("should update fetch status and increment attempts", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await updateFetchStatus(
        "woodland",
        "1.2.3",
        FetchStatus.TransientError,
        "S3 timeout",
      );

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { grantCode: "woodland", version: "1.2.3" },
        {
          $set: expect.objectContaining({
            fetchStatus: FetchStatus.TransientError,
            fetchError: "S3 timeout",
          }),
          $inc: { fetchAttempts: 1 },
        },
      );
    });

    it("should set fetchedAt when status is fetched", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await updateFetchStatus("woodland", "1.2.3", FetchStatus.Fetched);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { grantCode: "woodland", version: "1.2.3" },
        {
          $set: expect.objectContaining({
            fetchStatus: FetchStatus.Fetched,
            fetchedAt: expect.any(String),
          }),
          $inc: { fetchAttempts: 1 },
        },
      );
    });
  });

  describe("findByGrantCodeAndVersion", () => {
    it("should find a specific version", async () => {
      const doc = {
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "active",
        fetchStatus: FetchStatus.Fetched,
        fetchAttempts: 1,
        s3Key: "woodland/1.0.0/grant-definition.json",
        s3Bucket: "bucket",
        receivedAt: "2026-01-01T00:00:00Z",
        fetchedAt: "2026-01-01T00:01:00Z",
        fetchError: null,
        lastFetchAttemptAt: "2026-01-01T00:01:00Z",
      };
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await findByGrantCodeAndVersion("woodland", "1.0.0");
      expect(result).toBeInstanceOf(ConfigVersion);
      expect(result.fetchStatus).toBe(FetchStatus.Fetched);
    });

    it("should return null when not found", async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await findByGrantCodeAndVersion("woodland", "9.9.9");
      expect(result).toBeNull();
    });
  });
});
