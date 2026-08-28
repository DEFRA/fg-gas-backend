import { MongoServerError, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  collection,
  countByClaimCode,
  duplicateClientClaimRef,
  existsByClientClaimRef,
  insert,
} from "./claim.repository.js";

vi.mock("../../common/mongo-client.js");

describe("claim.repository", () => {
  it("returns true when a claim with the clientClaimRef exists", async () => {
    const session = {};
    const findOne = vi.fn().mockResolvedValue({ _id: new ObjectId() });
    db.collection.mockReturnValue({ findOne });

    const result = await existsByClientClaimRef(
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
      { session, projection: { _id: 1 } },
    );
    expect(result).toBe(true);
  });

  it("returns false when no claim with the clientClaimRef exists", async () => {
    const session = {};
    const findOne = vi.fn().mockResolvedValue(null);
    db.collection.mockReturnValue({ findOne });

    const result = await existsByClientClaimRef(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        clientClaimRef: "WMP-6HB-J8E-C0001",
      },
      session,
    );

    expect(result).toBe(false);
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

  it("inserts a claim with timestamps and returns the inserted id", async () => {
    const session = {};
    const insertedId = new ObjectId();
    const insertOne = vi.fn().mockResolvedValue({ insertedId });
    db.collection.mockReturnValue({ insertOne });

    const claimInput = {
      code: "woodland",
      clientRef: "wmp-6hb-j8e",
      claimCode: "ENT_CS_CAPITAL_PA3",
      clientClaimRef: "WMP-6HB-J8E-C0001",
      metadata: { grantCode: "woodland" },
      claim: { claimAmountPence: 150000 },
    };
    const result = await insert(claimInput, session);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        ...claimInput,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
      { session },
    );
    expect(result).toBe(insertedId);
  });

  it("returns duplicateClientClaimRef when the unique index is hit", async () => {
    const error = new MongoServerError("E11000 duplicate key");
    error.code = 11000;
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });

    const result = await insert({
      code: "woodland",
      clientRef: "wmp-6hb-j8e",
      claimCode: "ENT_CS_CAPITAL_PA3",
      clientClaimRef: "WMP-6HB-J8E-C0001",
      metadata: {},
      claim: {},
    });

    expect(result).toBe(duplicateClientClaimRef);
  });
});
