import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../common/logger.js";
import { db } from "../common/mongo-client.js";
import { reportAccessTokenIdentity } from "./access-token-identity.js";

vi.mock("../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../common/logger.js");

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

  it("logs counts as info when every token is named and dated", async () => {
    countsInOrder(4, 0, 0);

    await reportAccessTokenIdentity();

    expect(db.collection).toHaveBeenCalledWith("access_tokens");
    expect(logger.info).toHaveBeenCalledWith(
      "Access token identity: 4 named, 0 without a valid client name, 0 with an expiresAt that is not a date",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a record without a valid client name", [4, 1, 0]],
    ["an expiresAt that is not a date", [4, 0, 1]],
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
