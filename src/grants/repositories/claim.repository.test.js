import { MongoServerError, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  collection,
  countByClaimCode,
  duplicateClientClaimRef,
  findByClientClaimRef,
  insert,
} from "./claim.repository.js";

vi.mock("../../common/mongo-client.js");

describe("claim.repository", () => {
  it("finds a claim by clientClaimRef", async () => {
    const session = {};
    const doc = { clientClaimRef: "WMP-6HB-J8E-C0001" };
    const findOne = vi.fn().mockResolvedValue(doc);
    db.collection.mockReturnValue({ findOne });

    const result = await findByClientClaimRef(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        clientClaimRef: "WMP-6HB-J8E-C0001",
      },
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(collection);
    expect(findOne).toHaveBeenCalledWith(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        clientClaimRef: "WMP-6HB-J8E-C0001",
      },
      { session },
    );
    expect(result).toEqual(doc);
  });

  it("counts claims by claimCode", async () => {
    const session = {};
    const countDocuments = vi.fn().mockResolvedValue(2);
    db.collection.mockReturnValue({ countDocuments });

    const result = await countByClaimCode(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        claimCode: "ENT_CS_CAPITAL_PA3",
      },
      session,
    );

    expect(countDocuments).toHaveBeenCalledWith(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        claimCode: "ENT_CS_CAPITAL_PA3",
      },
      { session },
    );
    expect(result).toBe(2);
  });

  it("inserts a claim and returns the inserted id", async () => {
    const session = {};
    const insertedId = new ObjectId();
    const insertOne = vi.fn().mockResolvedValue({ insertedId });
    db.collection.mockReturnValue({ insertOne });

    const claim = { clientClaimRef: "WMP-6HB-J8E-C0001" };
    const result = await insert(claim, session);

    expect(insertOne).toHaveBeenCalledWith(claim, { session });
    expect(result).toBe(insertedId);
  });

  it("returns duplicateClientClaimRef when the unique index is hit", async () => {
    const error = new MongoServerError("E11000 duplicate key");
    error.code = 11000;
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });

    const result = await insert({ clientClaimRef: "WMP-6HB-J8E-C0001" });

    expect(result).toBe(duplicateClientClaimRef);
  });
});
