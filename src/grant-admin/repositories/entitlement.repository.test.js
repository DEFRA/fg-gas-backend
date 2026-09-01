import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { collection, insertEntitlement } from "./entitlement.repository.js";

vi.mock("../../common/mongo-client.js");

const entitlement = {
  id: "0e267c5a-1f0f-4c88-9a5e-30bb2c1f6fbb",
  clientRef: "wmp-abc-123",
  code: "woodland",
  claimCode: "ENT_CS_CAPITAL_PA3",
  instanceNumber: 1,
  configVersion: "1.1.0",
  data: { totalHectares: 455000 },
  createdAt: "2026-08-28T10:00:00.000Z",
};

describe("insertEntitlement", () => {
  it("stores the entitlement with its id as _id", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: entitlement.id });
    db.collection.mockReturnValue({ insertOne });

    await insertEntitlement(entitlement);

    expect(db.collection).toHaveBeenCalledWith(collection);
    expect(insertOne).toHaveBeenCalledWith(
      { _id: entitlement.id, ...entitlement },
      { session: undefined },
    );
  });

  it("does not persist fields outside the entitlement document", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: entitlement.id });
    db.collection.mockReturnValue({ insertOne });

    await insertEntitlement({
      ...entitlement,
      domainOnlyField: "must not be stored",
    });

    expect(insertOne).toHaveBeenCalledWith(
      { _id: entitlement.id, ...entitlement },
      { session: undefined },
    );
  });

  it("throws Boom.conflict when the id already exists", async () => {
    const error = new MongoServerError({ message: "duplicate" });
    error.code = 11000;
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });

    await expect(insertEntitlement(entitlement)).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: `Entitlement with id "${entitlement.id}" exists`,
    });
  });

  it("reports a claimed entitlement slot without converting it to an id conflict", async () => {
    const error = new MongoServerError({ message: "duplicate" });
    error.code = 11000;
    error.keyPattern = {
      clientRef: 1,
      code: 1,
      claimCode: 1,
      instanceNumber: 1,
    };
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });

    await expect(insertEntitlement(entitlement)).resolves.toBe(false);
  });

  it("rethrows other errors", async () => {
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(new Error("connection lost")),
    });

    await expect(insertEntitlement(entitlement)).rejects.toThrow(
      "connection lost",
    );
  });
});
