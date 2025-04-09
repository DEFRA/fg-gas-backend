import { describe, it, expect, vi } from "vitest";
import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../common/db.js";
import * as applicationRepository from "./application-repository.js";

vi.mock("../common/db.js", () => ({
  db: {
    collection: vi.fn(),
  },
}));

describe("add", () => {
  it("stores an application", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    db.collection.mockReturnValue({
      insertOne,
    });

    await applicationRepository.add({
      clientRef: "application-1",
      grantCode: "grant-1",
      createdAt: new Date("2021-01-01T00:00:00.000Z"),
      submittedAt: new Date("2021-01-01T00:00:00.000Z"),
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(insertOne).toHaveBeenCalledWith({
      clientRef: "application-1",
      grantCode: "grant-1",
      createdAt: new Date("2021-01-01T00:00:00.000Z"),
      submittedAt: new Date("2021-01-01T00:00:00.000Z"),
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });
  });

  it("throws Boom.conflict when an application with same clientRef already exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    const promise = applicationRepository.add({
      clientRef: "application-1",
      grantCode: "grant-1",
      createdAt: new Date("2021-01-01T00:00:00.000Z"),
      submittedAt: new Date("2021-01-01T00:00:00.000Z"),
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    await expect(promise).rejects.toThrow(
      Boom.conflict(
        'Application with clientRef "application-1" already exists',
      ),
    );
  });

  it("throws Boom.internal when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    const promise = applicationRepository.add({
      clientRef: "application-1",
      grantCode: "grant-1",
      createdAt: new Date("2021-01-01T00:00:00.000Z"),
      submittedAt: new Date("2021-01-01T00:00:00.000Z"),
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    await expect(promise).rejects.toThrow(Boom.internal(error));
  });
});
