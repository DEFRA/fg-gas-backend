import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";
import {
  backfillClientIds,
  createSeededClientIdIndex,
  reportAccessTokenIdentity,
  SEEDED_CLIENT_ID_INDEX,
} from "./access-token-identity.js";

vi.mock("../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../common/logger.js");

const collisions = (records) => ({
  toArray: vi.fn().mockResolvedValue(records ? [{ records }] : []),
});

describe("backfillClientIds", () => {
  it("returns how many tokens it changed", async () => {
    const accessTokens = {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 3 }),
    };

    expect(await backfillClientIds(accessTokens)).toBe(3);
    expect(accessTokens.updateMany).toHaveBeenCalledWith(expect.any(Object), [
      { $set: { clientId: "$client" } },
    ]);
  });
});

describe("createSeededClientIdIndex", () => {
  let accessTokens;

  beforeEach(() => {
    accessTokens = {
      aggregate: vi.fn().mockReturnValue(collisions(0)),
      createIndex: vi.fn().mockResolvedValue(SEEDED_CLIENT_ID_INDEX),
    };
  });

  it("creates the index when no seeded records share a clientId", async () => {
    expect(await createSeededClientIdIndex(accessTokens)).toBe(true);
    expect(accessTokens.createIndex).toHaveBeenCalledWith(
      { clientId: 1, seeded: 1 },
      {
        unique: true,
        partialFilterExpression: {
          seeded: true,
          clientId: { $type: "string" },
        },
        name: SEEDED_CLIENT_ID_INDEX,
      },
    );
  });

  it("skips the index when seeded records share a clientId", async () => {
    accessTokens.aggregate.mockReturnValue(collisions(2));

    expect(await createSeededClientIdIndex(accessTokens)).toBe(false);
    expect(accessTokens.createIndex).not.toHaveBeenCalled();
  });

  it("skips the index when a duplicate appears after the check", async () => {
    accessTokens.createIndex.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 }),
    );

    expect(await createSeededClientIdIndex(accessTokens)).toBe(false);
  });

  it("fails on any other error", async () => {
    accessTokens.createIndex.mockRejectedValue(new Error("connection lost"));

    await expect(createSeededClientIdIndex(accessTokens)).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("reportAccessTokenIdentity", () => {
  let accessTokens;

  const countsInOrder = (...counts) => {
    counts.forEach((count) =>
      accessTokens.countDocuments.mockResolvedValueOnce(count),
    );
  };

  beforeEach(() => {
    accessTokens = {
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    db.collection.mockReturnValue(accessTokens);
  });

  it("logs counts as info once only canonical records remain", async () => {
    countsInOrder(4, 1, 0, 0, 0, 0);

    await reportAccessTokenIdentity();

    expect(db.collection).toHaveBeenCalledWith("access_tokens");
    expect(logger.info).toHaveBeenCalledWith(
      "Access token identity: 4 canonical, 1 conflicting, 0 client only, 0 admin client only, 0 without an identity, 0 with an expiresAt that is not a date, 0 without a valid client name",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin client only record", [4, 0, 1, 0, 0, 0]],
    ["a client only record", [4, 0, 0, 1, 0, 0]],
    ["a record without an identity", [4, 0, 0, 0, 1, 0]],
    ["an expiresAt that is not a date", [4, 0, 0, 0, 0, 1]],
    ["a record without a valid client name", [4, 0, 0, 0, 0, 0, 1]],
  ])("warns while %s remains", async (_, counts) => {
    countsInOrder(...counts);

    await reportAccessTokenIdentity();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("counts every expiresAt that is neither a date nor null, an array of dates among them", async () => {
    await reportAccessTokenIdentity();

    expect(accessTokens.countDocuments).toHaveBeenCalledWith(
      {
        $expr: {
          $not: [
            { $in: [{ $type: "$expiresAt" }, ["missing", "null", "date"]] },
          ],
        },
      },
      { readPreference: "primary" },
    );
  });

  it("logs an error instead of failing startup", async () => {
    accessTokens.countDocuments.mockRejectedValue(
      Object.assign(new Error("not primary"), { code: 10107 }),
    );

    await expect(reportAccessTokenIdentity()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { code: 10107 },
      "Failed to report access token identity: not primary",
    );
  });
});
