import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { Claim } from "../models/claim.js";
import {
  collection,
  countByClaimCode,
  countByEntitlement,
  existsByClientClaimRef,
  findByApplication,
  insert,
} from "./claim.repository.js";

const claimProps = {
  code: "woodland",
  clientRef: "wmp-6hb-j8e",
  claimCode: "ENT_CS_CAPITAL_PA3",
  clientClaimRef: "WMP-6HB-J8E-C0001",
  entitlementId: "entitlement-1",
  metadata: { grantCode: "woodland" },
  claim: { entitlementId: "entitlement-1", totalClaimAmountPence: 150000 },
};

vi.mock("../../common/mongo-client.js");

describe("claim.repository", () => {
  it("returns an empty list when no claims have been submitted", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    db.collection.mockReturnValue({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ toArray }),
      }),
    });

    await expect(findByApplication(claimProps, {})).resolves.toEqual([]);
  });

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

  it("counts claims by entitlement", async () => {
    const session = {};
    const countDocuments = vi.fn().mockResolvedValue(1);
    db.collection.mockReturnValue({ countDocuments });

    const result = await countByEntitlement(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        entitlementId: "entitlement-1",
      },
      session,
    );

    expect(countDocuments).toHaveBeenCalledWith(
      {
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        entitlementId: "entitlement-1",
      },
      { session },
    );
    expect(result).toBe(1);
  });

  it("writes the Claim's own fields and returns the inserted id", async () => {
    const session = {};
    const insertedId = new ObjectId();
    const insertOne = vi.fn().mockResolvedValue({ insertedId });
    db.collection.mockReturnValue({ insertOne });

    const claim = Claim.create(claimProps);
    const result = await insert(claim, session);

    expect(insertOne).toHaveBeenCalledWith(
      {
        ...claimProps,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
      },
      { session },
    );
    expect(result).toBe(insertedId);
  });

  // The Claim is frozen, so the document must carry its own copies of the
  // submitted bodies rather than references into the model.
  it("writes copies of the submitted bodies", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    db.collection.mockReturnValue({ insertOne });

    const claim = Claim.create(claimProps);
    await insert(claim, {});

    const [document] = insertOne.mock.calls[0];
    expect(document.metadata).not.toBe(claim.metadata);
    expect(document.claim).not.toBe(claim.claim);
    expect(Object.isFrozen(document.metadata)).toBe(false);
  });

  it("propagates a duplicate key error so the transaction can abort", async () => {
    const error = new Error("E11000 duplicate key");
    error.code = 11000;
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });

    await expect(
      insert({
        code: "woodland",
        clientRef: "wmp-6hb-j8e",
        claimCode: "ENT_CS_CAPITAL_PA3",
        clientClaimRef: "WMP-6HB-J8E-C0001",
        metadata: {},
        claim: {},
      }),
    ).rejects.toBe(error);
  });

  it("returns an application's claims oldest first", async () => {
    const session = {};
    const claims = [
      {
        ...claimProps,
        _id: new ObjectId(),
        createdAt: "2026-09-10T17:29:55.456Z",
        updatedAt: "2026-09-10T17:29:55.456Z",
      },
      {
        ...claimProps,
        _id: new ObjectId(),
        clientClaimRef: "WMP-6HB-J8E-C0002",
        createdAt: "2026-09-11T17:29:55.456Z",
        updatedAt: "2026-09-11T17:29:55.456Z",
      },
    ];
    const toArray = vi.fn().mockResolvedValue(claims);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    db.collection.mockReturnValue({ find });

    const result = await findByApplication(
      { code: "woodland", clientRef: "wmp-6hb-j8e" },
      session,
    );

    expect(db.collection).toHaveBeenCalledWith(collection);
    expect(find).toHaveBeenCalledWith(
      { code: "woodland", clientRef: "wmp-6hb-j8e" },
      { session },
    );
    expect(sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(result).toHaveLength(2);
    result.forEach((claim, index) => {
      expect(claim).toBeInstanceOf(Claim);
      expect(claim.clientClaimRef).toBe(claims[index].clientClaimRef);
      expect(claim._id).toBeUndefined();
      expect(claim).toEqual({
        ...claimProps,
        clientClaimRef: claims[index].clientClaimRef,
        createdAt: claims[index].createdAt,
        updatedAt: claims[index].updatedAt,
      });
    });
  });
});
