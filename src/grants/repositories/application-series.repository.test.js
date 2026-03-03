import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { ApplicationSeries } from "../models/application-series.js";
import {
  findByClientRefAndCode,
  save,
  update,
} from "./application-series.repository.js";

vi.mock("../../common/mongo-client.js");

describe("findByClientRefAndCode", () => {
  it("queries by latestClientRef and code and returns an ApplicationSeries", async () => {
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

    expect(db.collection).toHaveBeenCalledWith("application_series");
    expect(findOne).toHaveBeenCalledWith(
      { latestClientRef: "ref-1", code: "grant-1" },
      { session },
    );
    expect(result).toBeInstanceOf(ApplicationSeries);
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
        'Application_series with currentClientRef "unknown-ref" and code "grant-1" not found.',
      ),
    );
  });
});

describe("save", () => {
  it("inserts the series document and returns the result", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "new-id" });
    db.collection.mockReturnValue({ insertOne });

    const series = ApplicationSeries.new({
      latestClientRef: "ref-1",
      latestClientId: "client-id-1",
      code: "grant-1",
    });
    const session = {};

    const result = await save(series, session);

    expect(db.collection).toHaveBeenCalledWith("application_series");
    expect(insertOne).toHaveBeenCalledWith(series.toDocument(), { session });
    expect(result).toEqual({ insertedId: "new-id" });
  });
});

describe("update", () => {
  it("replaces the series document and returns the result", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ replaceOne });

    const series = new ApplicationSeries({
      _id: "existing-id",
      clientRefs: ["ref-1", "ref-2"],
      latestClientRef: "ref-2",
      latestClientId: "client-id-2",
      code: "grant-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T12:00:00.000Z",
    });
    const session = {};

    const result = await update(series, session);

    expect(db.collection).toHaveBeenCalledWith("application_series");
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "existing-id" },
      series.toDocument(),
      { session },
    );
    expect(result).toEqual({ modifiedCount: 1 });
  });

  it("throws Boom.notFound when no document was modified", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({ modifiedCount: 0 });
    db.collection.mockReturnValue({ replaceOne });

    const series = new ApplicationSeries({
      _id: "missing-id",
      clientRefs: ["ref-1"],
      latestClientRef: "ref-1",
      latestClientId: "client-id-1",
      code: "grant-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    await expect(update(series, {})).rejects.toThrow(
      Boom.notFound(
        `Failed to update application_series with _id "missing-id"`,
      ),
    );
  });
});
