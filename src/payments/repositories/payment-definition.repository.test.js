import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  findPaymentDefinition,
  findStoredPaymentDefinition,
  findStoredVersions,
  insertPaymentDefinition,
  paymentDefinitionsCollection,
} from "./payment-definition.repository.js";

vi.mock("../../common/mongo-client.js");

const definition = { code: "pigs-might-fly", currency: "GBP" };

describe("Payment definition repository", () => {
  it("returns the definition rather than the record holding it", async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: "679ba1d5c2d3f4a5b6c7d8e9",
      code: "pigs-might-fly",
      version: "1.0.1",
      definition,
    });
    db.collection.mockReturnValue({ findOne });

    const result = await findPaymentDefinition("pigs-might-fly", "1.0.1");

    expect(db.collection).toHaveBeenCalledWith(paymentDefinitionsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { code: "pigs-might-fly", version: "1.0.1" },
      { readPreference: "primary" },
    );
    expect(result).toEqual(definition);
  });

  it("returns null when the definition is not stored", async () => {
    db.collection.mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) });

    await expect(
      findPaymentDefinition("pigs-might-fly", "9.9.9"),
    ).resolves.toBeNull();
  });

  it("stores the definition under its code and version", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: "id" });
    db.collection.mockReturnValue({ insertOne });

    const session = { id: "transaction" };

    const result = await insertPaymentDefinition(
      { code: "pigs-might-fly", version: "1.0.1", definition },
      session,
    );

    expect(insertOne).toHaveBeenCalledWith(
      { code: "pigs-might-fly", version: "1.0.1", definition },
      { session },
    );
    expect(result).toBeUndefined();
  });
});

describe("insertPaymentDefinition", () => {
  const insertRejecting = (error) =>
    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValue(error),
    });
  const insert = () =>
    insertPaymentDefinition({
      code: "pigs-might-fly",
      version: "1.0.1",
      definition,
    });

  it("leaves a version someone else stored first as it is", async () => {
    insertRejecting(
      new MongoServerError({ message: "E11000 duplicate key", code: 11000 }),
    );

    await expect(insert()).resolves.toBeUndefined();
  });

  it("lets a duplicate inside a transaction through, as it has aborted it", async () => {
    const duplicate = new MongoServerError({
      message: "E11000 duplicate key",
      code: 11000,
    });
    insertRejecting(duplicate);

    await expect(
      insertPaymentDefinition(
        { code: "pigs-might-fly", version: "1.0.1", definition },
        { id: "transaction" },
      ),
    ).rejects.toBe(duplicate);
  });

  it("lets any other Mongo failure through", async () => {
    const failure = new MongoServerError({ message: "down", code: 6 });
    insertRejecting(failure);

    await expect(insert()).rejects.toBe(failure);
  });
});

describe("findStoredVersions", () => {
  it("answers which of the asked versions are stored, reading versions alone", async () => {
    const toArray = vi.fn().mockResolvedValue([{ version: "1.0.1" }]);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({ find });

    const stored = await findStoredVersions("pigs-might-fly", [
      "1.0.1",
      "2.0.0",
    ]);

    expect(db.collection).toHaveBeenCalledWith(paymentDefinitionsCollection);
    expect(find).toHaveBeenCalledWith(
      { code: "pigs-might-fly", version: { $in: ["1.0.1", "2.0.0"] } },
      expect.objectContaining({ projection: { _id: 0, version: 1 } }),
    );
    expect(stored).toEqual(["1.0.1"]);
  });
});

const aggregating = (docs) => {
  const aggregate = vi.fn().mockReturnValue({ toArray: async () => docs });
  db.collection.mockReturnValue({ aggregate });
  return aggregate;
};

describe("findStoredPaymentDefinition", () => {
  const ref = { code: "pigs-might-fly", version: "1.0.0" };

  it("answers the definition as stored beside the record's size, within the admin read timeout", async () => {
    const aggregate = aggregating([{ storedBytes: 512, definition }]);

    expect(await findStoredPaymentDefinition(ref, { maxBytes: 1024 })).toEqual({
      storedBytes: 512,
      definition,
    });
    expect(db.collection).toHaveBeenCalledWith(paymentDefinitionsCollection);
    const [pipeline, options] = aggregate.mock.calls[0];
    expect(pipeline).toEqual([
      { $match: { code: "pigs-might-fly", version: "1.0.0" } },
      {
        $project: {
          _id: 0,
          storedBytes: { $bsonSize: "$$ROOT" },
          definition: {
            $cond: [
              { $lte: [{ $bsonSize: "$$ROOT" }, 1024] },
              "$definition",
              "$$REMOVE",
            ],
          },
        },
      },
    ]);
    expect(options).toEqual({ maxTimeMS: expect.any(Number) });
  });

  it("answers a record over maxBytes by its size alone", async () => {
    aggregating([{ storedBytes: 2048 }]);

    expect(await findStoredPaymentDefinition(ref, { maxBytes: 1024 })).toEqual({
      storedBytes: 2048,
      definition: null,
    });
  });

  it("answers null when the version's definition is not stored", async () => {
    aggregating([]);

    expect(
      await findStoredPaymentDefinition(ref, { maxBytes: 1024 }),
    ).toBeNull();
  });
});
