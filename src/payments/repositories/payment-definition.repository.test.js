import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  findPaymentDefinition,
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

    const result = await insertPaymentDefinition({
      code: "pigs-might-fly",
      version: "1.0.1",
      definition,
    });

    expect(insertOne).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      version: "1.0.1",
      definition,
    });
    expect(result).toBeUndefined();
  });
});
