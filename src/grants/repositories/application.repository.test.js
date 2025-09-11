import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { ApplicationDocument } from "../models/application-document.js";
import { Application } from "../models/application.js";
import { findByClientRef, save, update } from "./application.repository.js";

vi.mock("../../common/mongo-client.js");

describe("save", () => {
  it("stores an application", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    db.collection.mockReturnValue({
      insertOne,
    });

    await save(
      new Application({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-01T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(insertOne).toHaveBeenCalledWith(
      new ApplicationDocument({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-01T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),
    );
  });

  it("throws Boom.conflict when an application with same clientRef exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Application({
          clientRef: "application-1",
          code: "grant-1",
          createdAt: "2021-01-01T00:00:00.000Z",
          submittedAt: "2021-01-01T00:00:00.000Z",
          identifiers: {
            sbi: "sbi-1",
            frn: "frn-1",
            crn: "crn-1",
            defraId: "defraId-1",
          },
          answers: {
            anything: "test",
          },
        }),
      ),
    ).rejects.toThrow(
      Boom.conflict('Application with clientRef "application-1" exists'),
    );
  });

  it("throws when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Application({
          clientRef: "application-1",
          code: "grant-1",
          createdAt: "2021-01-01T00:00:00.000Z",
          submittedAt: "2021-01-01T00:00:00.000Z",
          identifiers: {
            sbi: "sbi-1",
            frn: "frn-1",
            crn: "crn-1",
            defraId: "defraId-1",
          },
          answers: {
            anything: "test",
          },
        }),
      ),
    ).rejects.toThrow(error);
  });
});

describe("findByClientRef", () => {
  it("finds an application by clientRef", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(
      new ApplicationDocument({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),
    );

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByClientRef("application-1");

    expect(result).toStrictEqual(
      new Application({
        clientRef: "application-1",
        code: "grant-1",
        createdAt: "2021-01-02T00:00:00.000Z",
        submittedAt: "2021-01-01T00:00:00.000Z",
        identifiers: {
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
        },
        answers: {
          anything: "test",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(findOne).toHaveBeenCalledWith({
      clientRef: "application-1",
    });
  });

  it("returns null when application not found", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByClientRef("non-existent-client-ref");

    expect(result).toBeNull();
  });
});

describe("update", () => {
  it("updates an application", async () => {
    const updateOne = vi.fn().mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    });

    db.collection.mockReturnValue({
      updateOne,
    });

    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-01T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        updatedField: "test",
      },
    });

    await update(application);

    expect(db.collection).toHaveBeenCalledWith("applications");

    expect(updateOne).toHaveBeenCalledWith(
      { clientRef: "application-1" },
      {
        $set: new ApplicationDocument({
          clientRef: "application-1",
          code: "grant-1",
          createdAt: "2021-01-01T00:00:00.000Z",
          submittedAt: "2021-01-01T00:00:00.000Z",
          identifiers: {
            sbi: "sbi-1",
            frn: "frn-1",
            crn: "crn-1",
            defraId: "defraId-1",
          },
          answers: {
            updatedField: "test",
          },
        }),
      },
    );
  });

  it("throws when an error occurs during update", async () => {
    const error = new Error("Database update failed");

    db.collection.mockReturnValue({
      updateOne: vi.fn().mockRejectedValueOnce(error),
    });

    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-01T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
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

    await expect(update(application)).rejects.toThrow(error);
  });
});
