import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findByGrantCode, replace } from "./grant-allow-list.repository.js";

vi.mock("../../common/mongo-client.js");

const document = {
  grantCode: "woodland",
  global: {
    sbi: ["106000033"],
    crn: ["1042000000"],
  },
};

describe("grant-allow-list.repository", () => {
  it("finds and rehydrates an allow list by grant code within a session", async () => {
    const session = {};
    const findOne = vi.fn().mockResolvedValue(document);
    db.collection.mockReturnValue({ findOne });

    const result = await findByGrantCode("woodland", session);

    expect(db.collection).toHaveBeenCalledWith("allow_lists");
    expect(findOne).toHaveBeenCalledWith(
      { grantCode: "woodland" },
      { session },
    );
    expect(result).toBeInstanceOf(GrantAllowList);
    expect(result.toJSON()).toEqual(document);
  });

  it("finds an allow list without passing undefined options", async () => {
    const findOne = vi.fn().mockResolvedValue(document);
    db.collection.mockReturnValue({ findOne });

    await findByGrantCode("woodland");

    expect(findOne).toHaveBeenCalledWith({ grantCode: "woodland" });
  });

  it("returns null when the grant has no allow list", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    db.collection.mockReturnValue({ findOne });

    await expect(findByGrantCode("woodland")).resolves.toBeNull();
  });

  it("refuses to rehydrate malformed stored state as unrestricted", async () => {
    const findOne = vi.fn().mockResolvedValue({ grantCode: "woodland" });
    db.collection.mockReturnValue({ findOne });

    await expect(findByGrantCode("woodland")).rejects.toMatchObject({
      output: {
        statusCode: 500,
        payload: { errorCode: "MALFORMED_ALLOW_LIST" },
      },
    });
  });

  it.each([
    ["invalid", { sbi: ["not-an-sbi"], crn: [] }],
    ["duplicate", { sbi: ["106000033", "106000033"], crn: [] }],
    ["blank", { sbi: [""], crn: [] }],
    ["padded", { sbi: [" 106000033 "], crn: [] }],
  ])(
    "reports %s stored identifiers as malformed persistence",
    async (_, global) => {
      const findOne = vi
        .fn()
        .mockResolvedValue({ grantCode: "woodland", global });
      db.collection.mockReturnValue({ findOne });

      await expect(findByGrantCode("woodland")).rejects.toMatchObject({
        output: {
          statusCode: 500,
          payload: { errorCode: "MALFORMED_ALLOW_LIST" },
        },
      });
    },
  );

  it("replaces the complete allow-list document within a session", async () => {
    const session = {};
    const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
    db.collection.mockReturnValue({ replaceOne });
    const allowList = new GrantAllowList(document);

    await replace(allowList, session);

    expect(replaceOne).toHaveBeenCalledWith(
      { grantCode: "woodland" },
      document,
      { upsert: true, session },
    );
  });

  it("replaces populated collections with empty collections", async () => {
    const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
    db.collection.mockReturnValue({ replaceOne });
    const allowList = GrantAllowList.unrestricted("woodland");

    await replace(allowList);

    expect(replaceOne).toHaveBeenCalledWith(
      { grantCode: "woodland" },
      { grantCode: "woodland", global: { sbi: [], crn: [] } },
      { upsert: true },
    );
    const [, replacement] = replaceOne.mock.calls[0];
    expect(Object.keys(replacement)).not.toEqual(
      expect.arrayContaining(["$set", "$addToSet"]),
    );
  });
});
