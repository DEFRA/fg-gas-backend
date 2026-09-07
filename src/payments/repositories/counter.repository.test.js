import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  CLAIM_ID_SEED,
  countersCollection,
  readClaimIdCounter,
  readPrimaryClaimIdCounter,
  setClaimIdCounterSequence,
} from "./counter.repository.js";

vi.mock("../../common/mongo-client.js");

const session = {};

describe("Counter repository", () => {
  it("exports the expected claim ID seed", () => {
    expect(CLAIM_ID_SEED).toBe(9_999_999);
  });

  it.each([
    { counter: { _id: "claimIds", seq: 9_999_999 }, expected: "document" },
    { counter: null, expected: "null" },
  ])("reads the claim ID counter when it is $expected", async ({ counter }) => {
    const findOne = vi.fn().mockResolvedValue(counter);
    db.collection.mockReturnValue({ findOne });

    await expect(readClaimIdCounter(session)).resolves.toEqual(counter);

    expect(db.collection).toHaveBeenCalledWith(countersCollection);
    expect(findOne).toHaveBeenCalledWith({ _id: "claimIds" }, { session });
  });

  it("reads the claim ID counter explicitly from the primary", async () => {
    const counter = { _id: "claimIds", seq: 4999 };
    const findOne = vi.fn().mockResolvedValue(counter);
    db.collection.mockReturnValue({ findOne });

    await expect(readPrimaryClaimIdCounter()).resolves.toEqual(counter);

    expect(db.collection).toHaveBeenCalledWith(countersCollection);
    expect(findOne).toHaveBeenCalledWith(
      { _id: "claimIds" },
      { readPreference: "primary" },
    );
  });

  it("sets the claim ID counter sequence on the caller's session", async () => {
    const result = { matchedCount: 1 };
    const updateOne = vi.fn().mockResolvedValue(result);
    db.collection.mockReturnValue({ updateOne });

    await expect(setClaimIdCounterSequence(4999, session)).resolves.toBe(
      result,
    );

    expect(db.collection).toHaveBeenCalledWith(countersCollection);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "claimIds" },
      { $set: { seq: 4999 } },
      { session },
    );
  });
});
