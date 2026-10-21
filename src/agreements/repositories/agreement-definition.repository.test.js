import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import {
  agreementDefinitionsCollection,
  findAgreementDefinition,
  findStoredVersions,
  insertAgreementDefinition,
} from "./agreement-definition.repository.js";

vi.mock("../../common/mongo-client.js");

const definition = { code: "pigs-might-fly", agreementNumberPrefix: "PMF" };

describe("Agreement definition repository", () => {
  it("returns the definition rather than the record holding it", async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: "679ba1d5c2d3f4a5b6c7d8e9",
      code: "pigs-might-fly",
      version: "1.0.1",
      definition,
    });
    db.collection.mockReturnValue({ findOne });

    const result = await findAgreementDefinition("pigs-might-fly", "1.0.1");

    expect(db.collection).toHaveBeenCalledWith(agreementDefinitionsCollection);
    expect(findOne).toHaveBeenCalledWith(
      { code: "pigs-might-fly", version: "1.0.1" },
      { readPreference: "primary" },
    );
    expect(result).toEqual(definition);
  });

  it("returns null when the definition is not stored", async () => {
    db.collection.mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) });

    await expect(
      findAgreementDefinition("pigs-might-fly", "9.9.9"),
    ).resolves.toBeNull();
  });

  it("stores the definition under its code and version", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: "id" });
    db.collection.mockReturnValue({ insertOne });

    const result = await insertAgreementDefinition({
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

describe("findStoredVersions", () => {
  it("answers which of the asked versions are stored, reading versions alone", async () => {
    const toArray = vi.fn().mockResolvedValue([{ version: "1.0.1" }]);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({ find });

    const stored = await findStoredVersions("pigs-might-fly", [
      "1.0.1",
      "2.0.0",
    ]);

    expect(db.collection).toHaveBeenCalledWith(agreementDefinitionsCollection);
    expect(find).toHaveBeenCalledWith(
      { code: "pigs-might-fly", version: { $in: ["1.0.1", "2.0.0"] } },
      expect.objectContaining({ projection: { _id: 0, version: 1 } }),
    );
    expect(stored).toEqual(["1.0.1"]);
  });
});
