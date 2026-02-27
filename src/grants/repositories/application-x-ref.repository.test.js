import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { ApplicationXRef } from "../models/application-x-ref.js";
import {
  findByClientRef,
  save,
  update,
} from "./application-x-ref.repository.js";

vi.mock("../../common/mongo-client.js");

describe("findByClientRef", () => {
  it("queries by currentClientRef array and returns an ApplicationXRef", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      _id: "doc-id",
      clientRefs: ["ref-1"],
      currentClientRef: "ref-1",
      currentClientId: "client-id-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    db.collection.mockReturnValue({ findOne });
    const session = {};

    const result = await findByClientRef("ref-1", session);

    expect(db.collection).toHaveBeenCalledWith("application_xref");
    expect(findOne).toHaveBeenCalledWith(
      { currentClientRef: "ref-1" },
      { session },
    );
    expect(result).toBeInstanceOf(ApplicationXRef);
    expect(result.currentClientRef).toBe("ref-1");
    expect(result.currentClientId).toBe("client-id-1");
  });

  it("throws an error when no document is found", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(null);
    db.collection.mockReturnValue({ findOne });

    await expect(findByClientRef("unknown-ref", {})).rejects.toThrow(
      Boom.notFound(
        'Application_xref with currentClientRef "unknown-ref" not found.',
      ),
    );
  });
});

describe("save", () => {
  it("inserts the xref document and returns the result", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "new-id" });
    db.collection.mockReturnValue({ insertOne });

    const xref = ApplicationXRef.new({
      currentClientRef: "ref-1",
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
  it("replaces the xref document and returns the result", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ replaceOne });

    const xref = new ApplicationXRef({
      _id: "existing-id",
      clientRefs: ["ref-1", "ref-2"],
      currentClientRef: "ref-2",
      currentClientId: "client-id-2",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
    });
    const session = {};

    const result = await update(xref, session);

    expect(db.collection).toHaveBeenCalledWith("application_xref");
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "existing-id" },
      xref.toDocument(),
      { session },
    );
    expect(result).toEqual({ modifiedCount: 1 });
  });

  it("throws Boom.notFound when no document was modified", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 0 });
    db.collection.mockReturnValue({ replaceOne });

    const xref = new ApplicationXRef({
      _id: "missing-id",
      clientRefs: ["ref-1"],
      currentClientRef: "ref-1",
      currentClientId: "client-id-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    await expect(update(xref, {})).rejects.toThrow(
      Boom.notFound(`Failed to update application_xref with _id "missing-id"`),
    );
  });
});
