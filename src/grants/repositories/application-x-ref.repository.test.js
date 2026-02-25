import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { ApplicationXRef } from "../models/application-x-ref.js";
import { save, update } from "./application-x-ref.repository.js";

vi.mock("../../common/mongo-client.js");

describe("save", () => {
  it("inserts the xref document and returns the result", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "new-id" });
    db.collection.mockReturnValue({ insertOne });

    const xref = ApplicationXRef.new({
      clientRefs: ["ref-1"],
      currentClientId: "client-id-1",
    });
    const session = {};

    const result = await save(xref, session);

    expect(db.collection).toHaveBeenCalledWith("application_xref");
    expect(insertOne).toHaveBeenCalledWith(xref.toDocument(), { session });
    expect(result).toEqual({ insertedId: "new-id" });
  });
});

describe("update", () => {
  it("updates the xref document and returns the result", async () => {
    const updateOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ updateOne });

    const xref = new ApplicationXRef({
      _id: "existing-id",
      clientRefs: ["ref-1", "ref-2"],
      currentClientId: "client-id-2",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
    });
    const session = {};

    const result = await update(xref, session);

    expect(db.collection).toHaveBeenCalledWith("application_xref");
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "existing-id" },
      xref.toDocument(),
      { session },
    );
    expect(result).toEqual({ modifiedCount: 1 });
  });

  it("throws Boom.notFound when no document was modified", async () => {
    const updateOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 0 });
    db.collection.mockReturnValue({ updateOne });

    const xref = new ApplicationXRef({
      _id: "missing-id",
      clientRefs: ["ref-1"],
      currentClientId: "client-id-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    await expect(update(xref, {})).rejects.toThrow(
      Boom.notFound(`Failed to update application_xref with _id "missing-id"`),
    );
  });
});
