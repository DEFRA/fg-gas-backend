import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { ApplicationXRef } from "../models/application-x-ref.js";
import {
  findByClientRefAndCode,
  save,
  update,
} from "./application-x-ref.repository.js";

vi.mock("../../common/mongo-client.js");

describe("findByClientRefAndCode", () => {
  it("queries by latestClientRef and code and returns an ApplicationXRef", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      _id: "doc-id",
      clientRefs: ["ref-1"],
      latestClientRef: "ref-1",
      latestClientId: "client-id-1",
      code: "grant-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    db.collection.mockReturnValue({ findOne });
    const session = {};

    const result = await findByClientRefAndCode("ref-1", "grant-1", session);

    expect(db.collection).toHaveBeenCalledWith("application_xref");
    expect(findOne).toHaveBeenCalledWith(
      { latestClientRef: "ref-1", code: "grant-1" },
      { session },
    );
    expect(result).toBeInstanceOf(ApplicationXRef);
    expect(result.latestClientRef).toBe("ref-1");
    expect(result.latestClientId).toBe("client-id-1");
  });

  it("throws an error when no document is found", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(null);
    db.collection.mockReturnValue({ findOne });

    await expect(
      findByClientRefAndCode("unknown-ref", "grant-1", {}),
    ).rejects.toThrow(
      Boom.notFound(
        'Application_xref with currentClientRef "unknown-ref" and code "grant-1" not found.',
      ),
    );
  });
});

describe("save", () => {
  it("inserts the xref document and returns the result", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "new-id" });
    db.collection.mockReturnValue({ insertOne });

    const xref = ApplicationXRef.new({
      latestClientRef: "ref-1",
      latestClientId: "client-id-1",
      code: "grant-1",
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
      latestClientRef: "ref-2",
      latestClientId: "client-id-2",
      code: "grant-1",
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
      latestClientRef: "ref-1",
      latestClientId: "client-id-1",
      code: "grant-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    await expect(update(xref, {})).rejects.toThrow(
      Boom.notFound(`Failed to update application_xref with _id "missing-id"`),
    );
  });
});
